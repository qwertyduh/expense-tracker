package com.buildqwertyduh.expensetracker

import android.content.Context

/**
 * Shared preferences shared by the accessibility service, the Quick Settings
 * tile and the JS Settings screen (via PaymentDetectionModule). Kept in one
 * file so the JS toggle, the tile and the capture handler always agree.
 */
object PaymentPrefs {

    const val FILE = "payment_detection"

    private const val KEY_ENABLED = "detection_enabled"
    private const val KEY_MODE = "detection_mode"

    /** Auto-file known payees, ask for new ones (default). */
    const val MODE_AUTO = "auto"

    /** Always show the card, even for known payees. */
    const val MODE_ASK = "ask"

    /** Never ask: known payees use memory, unknown payees go to Unsorted. */
    const val MODE_AUTO_ALL = "auto_all"

    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun mode(context: Context): String =
        prefs(context).getString(KEY_MODE, MODE_AUTO) ?: MODE_AUTO

    fun setMode(context: Context, mode: String) {
        prefs(context).edit().putString(KEY_MODE, mode).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
