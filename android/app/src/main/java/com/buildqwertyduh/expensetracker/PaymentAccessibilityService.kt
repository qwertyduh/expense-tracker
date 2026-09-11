package com.buildqwertyduh.expensetracker

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/**
 * Watches GPay and detects a committed payment.
 *
 * The "Enter your PIN" screen is readable and already contains the amount
 * ("Pay ₹1.00") and recipient ("To Pranay Bansal"). The "Payment successful"
 * screen is FLAG_SECURE (unreadable), so we can't confirm success directly —
 * instead we treat a click on the PIN screen's Pay action as the commit signal,
 * which avoids the cancel/back false positives of a "left the screen" heuristic.
 *
 * On commit the raw (PIN-stripped) screen text is handed to
 * [PaymentCaptureHandler], which either auto-saves (known payee) or shows the
 * floating category/split card (unknown payee).
 */
class PaymentAccessibilityService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private var pendingPaymentText: String? = null
    private var payClicked = false

    private val captureRunnable = Runnable { processCapture() }
    private val captureHandler by lazy { PaymentCaptureHandler(applicationContext) }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        reset()
        Log.i(TAG, "service connected")
    }

    override fun onInterrupt() = reset()

    override fun onDestroy() {
        if (instance === this) instance = null
        reset()
        super.onDestroy()
    }

    private fun reset() {
        handler.removeCallbacks(captureRunnable)
        pendingPaymentText = null
        payClicked = false
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val ev = event ?: return
        val pkg = ev.packageName?.toString() ?: rootInActiveWindow?.packageName?.toString()
        if (pkg != GPAY_PACKAGE) return

        when (ev.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                // Capture immediately (fast PIN-entry transitions) and again shortly
                // after (to catch the "left the PIN screen" transition).
                processCapture()
                handler.removeCallbacks(captureRunnable)
                handler.postDelayed(captureRunnable, CAPTURE_DELAY_MS)
            }

            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                val node = ev.source ?: return
                if (isPayAction(node)) {
                    Log.i(TAG, "Pay action clicked")
                    payClicked = true
                    // The PIN screen text (amount + payee) is already held.
                    commitPending()
                }
            }
        }
    }

    private fun processCapture() {
        val text = collectText(rootInActiveWindow)?.trim().orEmpty()

        if (isPinScreen(text)) {
            pendingPaymentText = text
            payClicked = false
            Log.i(TAG, "holding PIN screen: ${summarize(text)}")
            return
        }

        val held = pendingPaymentText ?: return
        pendingPaymentText = null

        if (FAILURE_MARKERS.any { text.lowercase(Locale.US).contains(it) }) {
            Log.i(TAG, "failure screen, discarding held payment")
            payClicked = false
            return
        }

        if (!payClicked) {
            Log.i(TAG, "left PIN screen without a Pay click, discarding")
            return
        }

        payClicked = false
        commit(held)
    }

    private fun commitPending() {
        val held = pendingPaymentText ?: return
        pendingPaymentText = null
        payClicked = false
        commit(held)
    }

    private fun commit(rawText: String) {
        Log.i(TAG, "payment committed: ${summarize(rawText)}")
        captureHandler.onCommitted(rawText)
    }

    /** True when the clicked node is GPay's Pay action (text/label "Pay"). */
    private fun isPayAction(node: AccessibilityNodeInfo): Boolean {
        val label = node.text?.toString() ?: node.contentDescription?.toString() ?: return false
        if (!PAY_WORD.containsMatchIn(label)) return false
        return hasClickableAncestor(node)
    }

    private fun hasClickableAncestor(node: AccessibilityNodeInfo?): Boolean {
        var current = node
        var depth = 0
        while (current != null && depth < 4) {
            if (current.isClickable) return true
            current = current.parent
            depth++
        }
        return false
    }

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

    /** Strip PIN digits and blank lines before logging. */
    private fun summarize(text: String): String =
        text.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !DIGIT_ONLY.matches(it) }
            .joinToString(" ")

    companion object {
        private const val TAG = "PaymentAccSvc"

        // The live service instance, used to host TYPE_ACCESSIBILITY_OVERLAY
        // windows (which may only be added by an enabled accessibility service).
        @Volatile
        var instance: PaymentAccessibilityService? = null
            private set

        // GPay (India) package name (verified on device).
        private const val GPAY_PACKAGE = "com.google.android.apps.nbu.paisa.user"

        private const val CAPTURE_DELAY_MS = 500L

        private val FAILURE_MARKERS = listOf(
            "payment failed",
            "transaction failed",
            "failed",
            "declined",
            "unsuccessful"
        )

        private val PAY_WORD = Regex("\\bpay\\b", RegexOption.IGNORE_CASE)
        private val AMOUNT_REGEX = Regex("(?:₹|Rs\\.?)\\s?([\\d,]+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE)
        private val DIGIT_ONLY = Regex("\\d{4,8}")
    }
}
