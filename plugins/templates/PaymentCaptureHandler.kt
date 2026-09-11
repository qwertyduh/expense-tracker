package com.buildqwertyduh.expensetracker

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import android.widget.Toast
import java.util.Locale

/**
 * Decides what to do with a committed GPay payment:
 *  - known payee  -> auto-save to its remembered category + snackbar (Undo/Change)
 *  - unknown payee -> floating category/split card (never launches the app)
 *  - ignored card  -> save under "Unsorted" so nothing is lost
 *
 * Falls back to the app's deep link only when the DB doesn't exist yet (the app
 * has never been opened, so there is nothing to file against).
 */
class PaymentCaptureHandler(context: Context) {

    private val appContext = context.applicationContext
    private val db = ExpenseDb(appContext)
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var lastHandledAt = 0L
    private var overlay: PaymentOverlayController? = null

    // Overlays must be hosted by the enabled accessibility service, so prefer
    // its context; fall back to the app context if the service isn't running.
    private val overlayContext: Context
        get() = PaymentAccessibilityService.instance ?: appContext

    fun onCommitted(rawText: String) {
        val parsed = GpayParser.parse(rawText)
        Log.i(TAG, "onCommitted amount=${parsed.amount} payee=${parsed.payee}")
        if (!isNew(parsed)) return

        if (!db.exists()) {
            Log.i(TAG, "DB missing, falling back to deep link")
            fireDeepLink(rawText)
            return
        }
        db.ensureCaptureSchema()

        val amount = parsed.amount
        val payee = parsed.payee?.takeIf { it.isNotBlank() }

        if (amount != null && payee != null) {
            val memory = db.merchantMemory(payee)
            if (memory != null) {
                Log.i(TAG, "known payee, auto-saving")
                autoSave(amount, payee, rawText, memory)
                return
            }
        }
        showOverlay(amount, payee, rawText)
    }

    private fun autoSave(total: Double, payee: String, rawText: String, memory: ExpenseDb.MerchantMemory) {
        val splitCount = memory.splitCount.coerceAtLeast(1)
        val selfShare = total / splitCount
        val id = db.insertExpense(
            ExpenseDb.NewExpense(total, selfShare, memory.categoryId, null, payee, sanitize(rawText))
        )
        if (id == null) {
            showOverlay(total, payee, rawText)
            return
        }
        db.touchCategory(memory.categoryId)

        val categoryName = db.categoryById(memory.categoryId)?.name ?: "Saved"
        val share = if (splitCount > 1) " \u00B7 your share \u20B9${fmt(selfShare)}" else ""
        snackbar().show(
            "Added \u20B9${fmt(total)} \u00B7 $categoryName ($payee)$share",
            listOf(
                "Undo" to {
                    db.deleteExpense(id)
                    toast("Removed")
                },
                "Change" to {
                    db.deleteExpense(id)
                    showOverlay(total, payee, rawText)
                }
            )
        )
    }

    private fun showOverlay(amount: Double?, payee: String?, rawText: String) {
        val context = overlayContext
        Log.i(TAG, "showing overlay (context=${context.javaClass.simpleName})")
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val categories = db.recentCategories(6)
        val controller = PaymentOverlayController(
            context,
            windowManager,
            categories,
            amount,
            payee,
            object : PaymentOverlayController.Listener {
                override fun onSelected(categoryName: String, splitCount: Int, amount: Double) {
                    overlay = null
                    val category = db.ensureCategory(categoryName)
                    val selfShare = amount / splitCount
                    db.insertExpense(
                        ExpenseDb.NewExpense(amount, selfShare, category.id, null, payee, sanitize(rawText))
                    )
                    db.touchCategory(category.id)
                    if (payee != null) db.rememberMerchant(payee, category.id, splitCount)
                    toast("Saved to ${category.name}")
                }

                override fun onTimedOut() {
                    overlay = null
                    val total = amount ?: return
                    val unsortedId = db.unsortedCategoryId()
                        ?: db.ensureCategory(ExpenseDb.UNSORTED_NAME).id
                    db.insertExpense(
                        ExpenseDb.NewExpense(total, total, unsortedId, null, payee, sanitize(rawText))
                    )
                    toast("Saved to Unsorted")
                }

                override fun onDismissed() {
                    overlay = null
                }
            }
        )
        overlay = controller
        controller.show()
    }

    private fun isNew(parsed: GpayParser.Parsed): Boolean {
        val now = System.currentTimeMillis()
        if (now - lastHandledAt < COOLDOWN_MS) return false
        lastHandledAt = now

        val key = "${parsed.amount}|${parsed.payee}"
        val lastKey = prefs.getString(KEY_LAST, null)
        val lastAt = prefs.getLong(KEY_LAST_AT, 0L)
        if (key == lastKey && now - lastAt < DEDUPE_WINDOW_MS) return false

        prefs.edit().putString(KEY_LAST, key).putLong(KEY_LAST_AT, now).apply()
        return true
    }

    private fun snackbar(): PaymentSnackbar {
        val context = overlayContext
        return PaymentSnackbar(context, context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
    }

    private fun toast(message: String) {
        mainHandler.post { Toast.makeText(appContext, message, Toast.LENGTH_SHORT).show() }
    }

    private fun sanitize(text: String): String =
        text.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !DIGIT_ONLY.matches(it) }
            .joinToString("\n")

    private fun fireDeepLink(rawText: String) {
        val uri = Uri.Builder()
            .scheme("expensetracker")
            .authority("add")
            .appendQueryParameter("bank", "gpay")
            .appendQueryParameter("data", sanitize(rawText))
            .build()
        val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            appContext.startActivity(intent)
        } catch (_: Exception) {
        }
    }

    private fun fmt(n: Double): String =
        if (n % 1.0 == 0.0) n.toLong().toString() else String.format(Locale.US, "%.2f", n)

    companion object {
        private const val TAG = "PaymentCapture"
        private const val PREFS = "payment_detection"
        private const val KEY_LAST = "last_payment_key"
        private const val KEY_LAST_AT = "last_payment_at"
        private const val COOLDOWN_MS = 3_000L
        private const val DEDUPE_WINDOW_MS = 5 * 60_000L
        private val DIGIT_ONLY = Regex("\\d{4,8}")
    }
}
