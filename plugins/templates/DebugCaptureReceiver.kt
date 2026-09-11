package com.buildqwertyduh.expensetracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Debug-only hook to exercise the capture pipeline without a real GPay payment.
 *
 *   adb shell am broadcast -a com.buildqwertyduh.expensetracker.DEBUG_CAPTURE \
 *     --es text "Pay ₹120.00\nTo Swiggy\nEnter your PIN"
 *
 * No-op in release builds.
 */
class DebugCaptureReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        Log.i("DebugCapture", "received action=${intent.action} debug=${BuildConfig.DEBUG}")
        if (!BuildConfig.DEBUG) return
        if (intent.action != ACTION) return
        val text = intent.getStringExtra(EXTRA_TEXT) ?: return
        // Allow "line1\nline2" from adb (which can't pass real newlines easily).
        PaymentCaptureHandler(context).onCommitted(text.replace("\\n", "\n"))
    }

    companion object {
        const val ACTION = "com.buildqwertyduh.expensetracker.DEBUG_CAPTURE"
        const val EXTRA_TEXT = "text"
    }
}
