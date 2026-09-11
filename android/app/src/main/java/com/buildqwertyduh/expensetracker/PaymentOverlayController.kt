package com.buildqwertyduh.expensetracker

import android.content.Context
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Bottom-anchored floating card shown over GPay after a committed payment whose
 * payee we don't recognise. Stage 1 picks a category (recent chips + Other),
 * stage 2 picks a split (No / 2 / 3 / 4 / More). Everything happens in this
 * overlay — the app is never launched.
 *
 * Uses TYPE_ACCESSIBILITY_OVERLAY, which an accessibility service may draw
 * without the draw-over-other-apps permission. If the card is ignored it
 * auto-dismisses and the caller files the expense under "Unsorted".
 */
class PaymentOverlayController(
    private val context: Context,
    private val windowManager: WindowManager,
    private val categories: List<ExpenseDb.Category>,
    private val initialAmount: Double?,
    private val payee: String?,
    private val listener: Listener
) {

    interface Listener {
        fun onSelected(categoryName: String, splitCount: Int, amount: Double)
        fun onTimedOut()
        fun onDismissed()
    }

    private val handler = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private var params: WindowManager.LayoutParams? = null
    private var amountInput: EditText? = null
    private var selectedCategory: String? = null
    private var dismissed = false
    private val categoryChips = mutableListOf<Pair<String, TextView>>()

    private val timeoutRunnable = Runnable {
        if (!dismissed) {
            dismissed = true
            hide()
            listener.onTimedOut()
        }
    }

    private val dark: Boolean
        get() = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private val cardColor get() = if (dark) 0xFF212225.toInt() else 0xFFFFFFFF.toInt()
    private val textColor get() = if (dark) 0xFFFFFFFF.toInt() else 0xFF000000.toInt()
    private val secondaryColor get() = if (dark) 0xFFB0B4BA.toInt() else 0xFF60646C.toInt()
    private val chipColor get() = if (dark) 0xFF2E3135.toInt() else 0xFFF0F0F3.toInt()
    private val selectedColor get() = if (dark) 0xFF3A3D42.toInt() else 0xFFE0E1E6.toInt()

    fun show() {
        if (root != null) return
        val card = buildCard()
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.BOTTOM }

        card.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_OUTSIDE) {
                dismiss()
                true
            } else {
                false
            }
        }

        try {
            windowManager.addView(card, lp)
        } catch (e: Exception) {
            Log.e(TAG, "failed to add overlay window", e)
            root = null
            listener.onDismissed()
            return
        }
        root = card
        params = lp
        scheduleTimeout()
    }

    private fun buildCard(): LinearLayout {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = rounded(cardColor, dp(18).toFloat())
        }
        val wrapper = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        wrapper.addView(card, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { setMargins(dp(12), 0, dp(12), dp(16)) })

        // Header
        val header = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        header.addView(
            TextView(context).apply {
                text = "Add expense"
                setTextColor(textColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )
        header.addView(TextView(context).apply {
            text = "\u2715"
            setTextColor(secondaryColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setPadding(dp(8), dp(4), dp(8), dp(4))
            setOnClickListener { dismiss() }
        })
        card.addView(header)

        // Amount + payee
        card.addView(TextView(context).apply {
            val who = payee?.takeIf { it.isNotBlank() }
            text = if (who != null) "To $who" else "Captured from GPay"
            setTextColor(secondaryColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, dp(2), 0, dp(6))
        })

        val amountRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        amountRow.addView(TextView(context).apply {
            text = "\u20B9"
            setTextColor(textColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        })
        if (initialAmount != null) {
            amountRow.addView(TextView(context).apply {
                text = formatAmount(initialAmount)
                setTextColor(textColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(dp(4), 0, 0, 0)
            })
        } else {
            val input = EditText(context).apply {
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                hint = "0"
                setTextColor(textColor)
                setHintTextColor(secondaryColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
                background = null
                minWidth = dp(90)
            }
            amountInput = input
            amountRow.addView(input)
        }
        card.addView(amountRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // Stage 1: category
        card.addView(label("Category"))
        val categoryContainer = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        card.addView(categoryContainer)

        val otherRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
            setPadding(0, dp(6), 0, 0)
        }
        val otherInput = EditText(context).apply {
            hint = "New category"
            setTextColor(textColor)
            setHintTextColor(secondaryColor)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            background = rounded(chipColor, dp(10).toFloat())
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }
        otherRow.addView(otherInput, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val otherAdd = TextView(context).apply {
            text = "Add"
            setTextColor(ACCENT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(dp(12), dp(8), dp(4), dp(8))
        }
        otherRow.addView(otherAdd)
        card.addView(otherRow)

        // Stage 2: split (revealed after a category is chosen)
        val splitContainer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        splitContainer.addView(label("Split?"))
        val splitRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        splitContainer.addView(splitRow)

        val moreRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
            setPadding(0, dp(6), 0, 0)
        }
        val moreInput = EditText(context).apply {
            hint = "People"
            setTextColor(textColor)
            setHintTextColor(secondaryColor)
            inputType = InputType.TYPE_CLASS_NUMBER
            background = rounded(chipColor, dp(10).toFloat())
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }
        moreRow.addView(moreInput, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val moreSet = TextView(context).apply {
            text = "Set"
            setTextColor(ACCENT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(dp(12), dp(8), dp(4), dp(8))
        }
        moreRow.addView(moreSet)
        splitContainer.addView(moreRow)
        card.addView(splitContainer)

        // Fill category chips (wrapping) + Other
        val categoryChipsSpec = categories.map { category ->
            category.name to { selectCategory(category.name, splitContainer) }
        } + ("Other" to {
            otherRow.visibility = View.VISIBLE
            focusInput(otherInput)
        })
        fillFlow(categoryContainer, categoryChipsSpec, categoryChips)

        otherAdd.setOnClickListener {
            val name = otherInput.text.toString().trim()
            if (name.isNotEmpty()) selectCategory(name, splitContainer)
        }

        // Fill split chips
        listOf(1 to "No", 2 to "2", 3 to "3", 4 to "4").forEach { (count, text) ->
            splitRow.addView(chip(text) { finalize(count) })
        }
        splitRow.addView(chip("More\u2026") {
            moreRow.visibility = View.VISIBLE
            focusInput(moreInput)
        })
        moreSet.setOnClickListener {
            val count = moreInput.text.toString().trim().toIntOrNull()
            if (count != null && count >= 2) finalize(count)
        }

        return wrapper
    }

    private fun selectCategory(name: String, splitContainer: LinearLayout) {
        selectedCategory = name
        categoryChips.forEach { (label, view) ->
            val isSelected = label.equals(name, ignoreCase = true)
            view.background = rounded(if (isSelected) selectedColor else chipColor, dp(999).toFloat())
        }
        splitContainer.visibility = View.VISIBLE
        scheduleTimeout()
    }

    private fun finalize(splitCount: Int) {
        val category = selectedCategory ?: return
        val amount = readAmount() ?: return
        dismissed = true
        hide()
        listener.onSelected(category, splitCount, amount)
    }

    private fun readAmount(): Double? {
        val typed = amountInput?.text?.toString()?.trim()
        if (typed.isNullOrEmpty()) return initialAmount
        return typed.toDoubleOrNull()
    }

    private fun dismiss() {
        if (dismissed) return
        dismissed = true
        hide()
        listener.onDismissed()
    }

    private fun hide() {
        handler.removeCallbacks(timeoutRunnable)
        root?.let {
            try {
                windowManager.removeView(it)
            } catch (_: Exception) {
            }
        }
        root = null
        params = null
    }

    private fun scheduleTimeout() {
        handler.removeCallbacks(timeoutRunnable)
        handler.postDelayed(timeoutRunnable, TIMEOUT_MS)
    }

    private fun focusInput(edit: EditText) {
        val lp = params ?: return
        lp.flags = lp.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        root?.let { windowManager.updateViewLayout(it, lp) }
        edit.requestFocus()
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
    }

    /**
     * Adds chips left-to-right, wrapping to a new row when the next chip would
     * exceed the available width (so no category is hidden off-screen).
     */
    private fun fillFlow(
        container: LinearLayout,
        chips: List<Pair<String, () -> Unit>>,
        track: MutableList<Pair<String, TextView>>
    ) {
        val maxWidth = context.resources.displayMetrics.widthPixels - dp(60)
        var row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        container.addView(row)
        var rowWidth = 0
        chips.forEach { (text, onClick) ->
            val view = chip(text, onClick)
            view.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
            val width = view.measuredWidth + dp(8)
            if (rowWidth > 0 && rowWidth + width > maxWidth) {
                row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
                container.addView(row)
                rowWidth = 0
            }
            row.addView(view)
            track.add(text to view)
            rowWidth += width
        }
    }

    private fun label(text: String): TextView = TextView(context).apply {
        this.text = text
        setTextColor(secondaryColor)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setPadding(0, dp(10), 0, dp(4))
    }

    private fun chip(text: String, onClick: () -> Unit): TextView = TextView(context).apply {
        this.text = text
        setTextColor(textColor)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = rounded(chipColor, dp(999).toFloat())
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            rightMargin = dp(8)
            topMargin = dp(4)
        }
        setOnClickListener { onClick() }
    }

    private fun rounded(color: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    private fun formatAmount(amount: Double): String =
        if (amount % 1.0 == 0.0) amount.toLong().toString() else String.format("%.2f", amount)

    companion object {
        private const val TAG = "PaymentOverlay"
        private const val ACCENT = 0xFF3C87F7.toInt()
        private const val TIMEOUT_MS = 8_000L
    }
}
