package com.buildqwertyduh.expensetracker

import android.content.Context
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Small bottom snackbar shown after an auto-saved payment, e.g.
 * "Added ₹450 · Food (Swiggy)" with Undo / Change actions. Auto-hides.
 */
class PaymentSnackbar(
    private val context: Context,
    private val windowManager: WindowManager
) {

    private val handler = Handler(Looper.getMainLooper())
    private var root: View? = null

    private val dark: Boolean
        get() = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private val hideRunnable = Runnable { hide() }

    fun show(message: String, actions: List<Pair<String, () -> Unit>> = emptyList()) {
        hide()
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(12), dp(12))
            background = rounded(if (dark) 0xFF212225.toInt() else 0xFF1F1F1F.toInt(), dp(14).toFloat())
        }
        val messageView = TextView(context).apply {
            this.text = message
            setTextColor(0xFFFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        }
        card.addView(messageView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        actions.forEach { (label, action) ->
            val button = TextView(context).apply {
                text = label
                setTextColor(0xFF7FB2FF.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(dp(12), dp(6), dp(6), dp(6))
                setOnClickListener {
                    hide()
                    action()
                }
            }
            card.addView(button)
        }

        val wrapper = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(12), dp(16))
        }
        wrapper.addView(card, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.BOTTOM }

        try {
            windowManager.addView(wrapper, lp)
        } catch (e: Exception) {
            return
        }
        root = wrapper
        handler.removeCallbacks(hideRunnable)
        handler.postDelayed(hideRunnable, SHOW_MS)
    }

    fun hide() {
        handler.removeCallbacks(hideRunnable)
        root?.let {
            try {
                windowManager.removeView(it)
            } catch (_: Exception) {
            }
        }
        root = null
    }

    private fun rounded(color: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    companion object {
        private const val SHOW_MS = 4_000L
    }
}
