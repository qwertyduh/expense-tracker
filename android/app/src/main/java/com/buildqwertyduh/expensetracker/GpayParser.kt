package com.buildqwertyduh.expensetracker

/**
 * Extracts the amount and payee from GPay's "Enter your PIN" screen text, which
 * the accessibility service concatenates line-by-line, e.g.:
 *
 *   State Bank of India
 *   Pay ₹1.00
 *   To Pranay Bansal
 *   Enter your PIN
 */
object GpayParser {

    data class Parsed(val amount: Double?, val payee: String?)

    private val AMOUNT_IN_PAY = Regex("(?i)pay[^\\n]*?(?:₹|rs\\.?)\\s?([\\d,]+(?:\\.\\d+)?)")
    private val ANY_AMOUNT = Regex("(?:₹|Rs\\.?)\\s?([\\d,]+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE)
    private val PAYEE = Regex("(?im)^to\\s+(.+)$")
    private val UPI_ID = Regex("[A-Za-z0-9._%+-]+@[A-Za-z]{2,}")

    fun parse(text: String): Parsed {
        val amountGroup = AMOUNT_IN_PAY.find(text)?.groupValues?.getOrNull(1)
            ?: ANY_AMOUNT.find(text)?.groupValues?.getOrNull(1)
        val amount = amountGroup?.replace(",", "")?.toDoubleOrNull()

        val payee = PAYEE.find(text)?.groupValues?.getOrNull(1)?.trim()
            ?: UPI_ID.find(text)?.value

        return Parsed(amount, payee)
    }
}
