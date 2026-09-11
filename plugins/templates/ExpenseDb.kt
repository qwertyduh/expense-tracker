package com.buildqwertyduh.expensetracker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Native access to the same SQLite file expo-sqlite uses
 * (context.filesDir/SQLite/expense-tracker.db), so the accessibility service can
 * persist a captured payment without launching the app.
 *
 * We deliberately do NOT create the base schema here: the JS layer owns it. If
 * the DB file does not exist yet, the app has never been opened (no categories,
 * no onboarding), so callers fall back to the deep-link flow. Only the additive
 * tables/rows introduced for capture (merchant_memory, the "Unsorted" category)
 * are ensured here, idempotently.
 */
class ExpenseDb(context: Context) {

    data class Category(val id: String, val name: String)
    data class MerchantMemory(val categoryId: String, val splitCount: Int)

    private val appContext = context.applicationContext
    private val dbFile = File(appContext.filesDir, "SQLite/expense-tracker.db")

    fun exists(): Boolean = dbFile.exists()

    private fun open(): SQLiteDatabase {
        dbFile.parentFile?.mkdirs()
        return SQLiteDatabase.openOrCreateDatabase(dbFile, null)
    }

    /** Additive schema/seed used by capture. Safe to run repeatedly. */
    fun ensureCaptureSchema() {
        if (!exists()) return
        open().use { db ->
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS merchant_memory (
                  merchant TEXT PRIMARY KEY,
                  category_id TEXT NOT NULL,
                  split_count INTEGER NOT NULL DEFAULT 1,
                  updated_at TEXT NOT NULL
                )
                """.trimIndent()
            )
            ensureUnsortedCategory(db)
        }
    }

    private fun ensureUnsortedCategory(db: SQLiteDatabase) {
        val now = nowIso()
        db.execSQL(
            "INSERT OR IGNORE INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, 9999, ?, ?)",
            arrayOf(UUID.randomUUID().toString(), UNSORTED_NAME, now, now)
        )
    }

    fun unsortedCategoryId(): String? =
        queryCategoryByName(UNSORTED_NAME)?.id

    /** Recent-first ordering, mirroring listRecentCategories() in JS. */
    fun recentCategories(limit: Int = 6): List<Category> {
        if (!exists()) return emptyList()
        open().use { db ->
            db.rawQuery(
                """
                SELECT id, name FROM categories
                ORDER BY last_used_at IS NULL ASC, last_used_at DESC, sort_order ASC
                LIMIT ?
                """.trimIndent(),
                arrayOf(limit.toString())
            ).use { cursor ->
                val out = ArrayList<Category>(cursor.count)
                while (cursor.moveToNext()) {
                    out.add(Category(cursor.getString(0), cursor.getString(1)))
                }
                return out
            }
        }
    }

    fun categoryById(id: String): Category? {
        if (!exists()) return null
        open().use { db ->
            db.rawQuery(
                "SELECT id, name FROM categories WHERE id = ? LIMIT 1",
                arrayOf(id)
            ).use { cursor ->
                if (cursor.moveToFirst()) return Category(cursor.getString(0), cursor.getString(1))
            }
        }
        return null
    }

    fun queryCategoryByName(name: String): Category? {
        if (!exists()) return null
        open().use { db ->
            db.rawQuery(
                "SELECT id, name FROM categories WHERE name = ? COLLATE NOCASE LIMIT 1",
                arrayOf(name)
            ).use { cursor ->
                if (cursor.moveToFirst()) return Category(cursor.getString(0), cursor.getString(1))
            }
        }
        return null
    }

    /** Returns the id of an existing category (case-insensitive) or creates it. */
    fun ensureCategory(name: String): Category {
        queryCategoryByName(name)?.let { return it }
        val now = nowIso()
        val id = UUID.randomUUID().toString()
        open().use { db ->
            val sortOrder = db.rawQuery("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories", null)
                .use { c -> if (c.moveToFirst()) c.getInt(0) else 1 }
            db.execSQL(
                "INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                arrayOf(id, name, sortOrder, now, now)
            )
        }
        return Category(id, name)
    }

    fun touchCategory(id: String) {
        val now = nowIso()
        open().use { db ->
            db.execSQL(
                "UPDATE categories SET last_used_at = ?, updated_at = ? WHERE id = ?",
                arrayOf(now, now, id)
            )
        }
    }

    fun merchantMemory(merchant: String): MerchantMemory? {
        if (!exists()) return null
        open().use { db ->
            db.rawQuery(
                "SELECT category_id, split_count FROM merchant_memory WHERE merchant = ? LIMIT 1",
                arrayOf(merchant)
            ).use { cursor ->
                if (cursor.moveToFirst()) {
                    return MerchantMemory(cursor.getString(0), cursor.getInt(1))
                }
            }
        }
        return null
    }

    fun rememberMerchant(merchant: String, categoryId: String, splitCount: Int) {
        val now = nowIso()
        open().use { db ->
            db.execSQL(
                """
                INSERT INTO merchant_memory (merchant, category_id, split_count, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(merchant) DO UPDATE SET
                  category_id = excluded.category_id,
                  split_count = excluded.split_count,
                  updated_at = excluded.updated_at
                """.trimIndent(),
                arrayOf(merchant, categoryId, splitCount, now)
            )
        }
    }

    data class NewExpense(
        val totalAmount: Double,
        val selfShare: Double,
        val categoryId: String,
        val label: String?,
        val merchant: String?,
        val rawText: String?
    )

    /**
     * Mirrors insertExpense() in src/db/expenses.ts: one expenses row plus an
     * append-only activity_log 'created' snapshot, in a single transaction.
     * Returns the new expense id, or null on failure.
     */
    fun insertExpense(input: NewExpense): String? {
        val expenseId = UUID.randomUUID().toString()
        val now = nowIso()
        val amount = round2(input.selfShare.coerceIn(0.0, input.totalAmount))
        val total = round2(input.totalAmount)
        val isSplit = if (amount < total) 1 else 0

        val snapshot = JSONObject().apply {
            put("id", expenseId)
            put("total_amount", total)
            put("amount", amount)
            put("currency", "INR")
            put("category_id", input.categoryId)
            put("label", input.label)
            put("merchant", input.merchant)
            put("source", SOURCE)
            put("bank_source", BANK_SOURCE)
            put("raw_sms_text", input.rawText)
            put("is_split", isSplit)
            put("occurred_at", now)
            put("created_at", now)
            put("updated_at", now)
        }

        return try {
            open().use { db ->
                db.beginTransaction()
                try {
                    db.execSQL(
                        """
                        INSERT INTO expenses
                          (id, amount, total_amount, currency, category_id, label, merchant,
                           source, bank_source, raw_sms_text, is_split, occurred_at, created_at, updated_at)
                        VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """.trimIndent(),
                        arrayOf(
                            expenseId, amount, total, input.categoryId, input.label, input.merchant,
                            SOURCE, BANK_SOURCE, input.rawText, isSplit, now, now, now
                        )
                    )
                    db.execSQL(
                        """
                        INSERT INTO activity_log (id, action, expense_id, expense_snapshot, occurred_at, created_at)
                        VALUES (?, 'created', ?, ?, ?, ?)
                        """.trimIndent(),
                        arrayOf(UUID.randomUUID().toString(), expenseId, snapshot.toString(), now, now)
                    )
                    db.setTransactionSuccessful()
                } finally {
                    db.endTransaction()
                }
            }
            expenseId
        } catch (e: Exception) {
            null
        }
    }

    fun deleteExpense(expenseId: String) {
        if (!exists()) return
        open().use { db ->
            db.beginTransaction()
            try {
                db.execSQL("DELETE FROM expenses WHERE id = ?", arrayOf(expenseId))
                db.execSQL(
                    "INSERT INTO activity_log (id, action, expense_id, expense_snapshot, occurred_at, created_at) VALUES (?, 'deleted', ?, '{}', ?, ?)",
                    arrayOf(UUID.randomUUID().toString(), expenseId, nowIso(), nowIso())
                )
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        }
    }

    private fun round2(n: Double): Double = Math.round(n * 100.0) / 100.0

    private fun nowIso(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }

    companion object {
        const val UNSORTED_NAME = "Unsorted"
        private const val SOURCE = "sms"
        private const val BANK_SOURCE = "gpay"
    }
}
