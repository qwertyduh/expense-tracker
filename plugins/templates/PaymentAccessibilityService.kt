package com.buildqwertyduh.expensetracker

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/**
 * Captures GPay's "Enter your PIN" confirmation screen, which is readable by an
 * accessibility service and already contains the amount ("Pay ₹1.00") and
 * recipient ("To Pranay Bansal"). The subsequent "Payment successful" screen is
 * FLAG_SECURE (unreadable), so we can't see it — instead we hold the PIN screen
 * and fire the deep link once the user leaves it (i.e. commits the payment).
 *
 * Trade-off: we can't verify success, so a cancelled/declined payment may still
 * open the pre-filled add flow; the user can discard it with the ✕. This is the
 * accepted cost of the PIN-screen approach.
 *
 * The deep link (expensetracker://add?bank=gpay&data=<text>) reuses the existing
 * JS deep-link -> parser -> prefill pipeline.
 */
class PaymentAccessibilityService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private var pendingPaymentText: String? = null
    private var lastFiredAt: Long = 0L

    private val captureRunnable = Runnable { processCapture() }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: rootInActiveWindow?.packageName?.toString()
        if (pkg != GPAY_PACKAGE) return

        val type = event?.eventType ?: return
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) return

        // Capture immediately (fast PIN-entry transitions), and again shortly
        // after (to catch the "left the PIN screen" transition, whose target may
        // be a FLAG_SECURE window that reads back as null/empty).
        processCapture()
        handler.removeCallbacks(captureRunnable)
        handler.postDelayed(captureRunnable, CAPTURE_DELAY_MS)
    }

    private fun processCapture() {
        val text = collectText(rootInActiveWindow)?.trim().orEmpty()

        if (isPinScreen(text)) {
            // Remember the latest PIN screen (amount + recipient are stable).
            pendingPaymentText = text
            Log.i(TAG, "holding PIN screen: ${summarize(text)}")
            return
        }

        val held = pendingPaymentText ?: return
        pendingPaymentText = null

        val lower = text.lowercase(Locale.US)
        if (FAILURE_MARKERS.any { lower.contains(it) }) {
            Log.i(TAG, "looks like a failure, discarding held payment")
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastFiredAt < COOLDOWN_MS) {
            Log.i(TAG, "cooldown, not firing")
            return
        }

        lastFiredAt = now
        Log.i(TAG, "payment committed, firing deep link: ${summarize(held)}")
        fireDeepLink(held)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "service connected")
        pendingPaymentText = null
        lastFiredAt = 0L
    }

    override fun onInterrupt() {}

    /** Concatenate every non-blank label on screen, one per line. */
    private fun collectText(root: AccessibilityNodeInfo?): String? {
        if (root == null) return null
        val sb = StringBuilder()
        collect(root, sb)
        return sb.toString().trim()
    }

    private fun collect(node: AccessibilityNodeInfo, sb: StringBuilder) {
        node.text?.toString()?.takeIf { it.isNotBlank() }?.let { sb.append(it).append('\n') }
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { sb.append(it).append('\n') }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collect(child, sb)
        }
    }

    /** The PIN confirmation screen shows the amount and recipient and asks for a PIN. */
    private fun isPinScreen(text: String): Boolean {
        val lower = text.lowercase(Locale.US)
        return lower.contains("enter your pin") && (lower.contains("₹") || AMOUNT_REGEX.containsMatchIn(text))
    }

    /** Strip PIN digits and blank lines before logging or shipping the text. */
    private fun sanitize(text: String): String =
        text.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !DIGIT_ONLY.matches(it) }
            .joinToString("\n")

    private fun summarize(text: String): String = sanitize(text).replace('\n', ' ')

    private fun fireDeepLink(rawText: String) {
        val uri = Uri.Builder()
            .scheme("expensetracker")
            .authority("add")
            .appendQueryParameter("bank", "gpay")
            .appendQueryParameter("data", sanitize(rawText))
            .build()

        val intent = Intent(Intent.ACTION_VIEW, uri)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "failed to fire deep link", e)
        }
    }

    companion object {
        private const val TAG = "PaymentAccSvc"

        // GPay (India) package name (verified on device).
        private const val GPAY_PACKAGE = "com.google.android.apps.nbu.paisa.user"

        private const val CAPTURE_DELAY_MS = 500L
        private const val COOLDOWN_MS = 10_000L

        private val FAILURE_MARKERS = listOf(
            "payment failed",
            "transaction failed",
            "failed",
            "declined",
            "unsuccessful"
        )

        private val AMOUNT_REGEX = Regex("(?:₹|Rs\\.?)\\s?[\\d,]+(?:\\.\\d+)?")
        private val DIGIT_ONLY = Regex("\\d{4,8}")
    }
}
