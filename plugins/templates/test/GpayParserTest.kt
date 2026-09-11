package com.buildqwertyduh.expensetracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GpayParserTest {

    @Test
    fun extractsAmountAndPayee() {
        val text = "State Bank of India\nPay ₹1.00\nTo Pranay Bansal\nEnter your PIN"
        val parsed = GpayParser.parse(text)
        assertEquals(1.0, parsed.amount!!, 0.0001)
        assertEquals("Pranay Bansal", parsed.payee)
    }

    @Test
    fun anchorsAmountToThePayLine() {
        // A balance shown elsewhere on screen must not win over the Pay amount.
        val text = "Balance ₹9,999.00\nPay ₹250.50\nTo Swiggy"
        val parsed = GpayParser.parse(text)
        assertEquals(250.5, parsed.amount!!, 0.0001)
    }

    @Test
    fun handlesCommaGroupedAmounts() {
        val parsed = GpayParser.parse("Pay ₹1,234.50\nTo Big Bazaar")
        assertEquals(1234.5, parsed.amount!!, 0.0001)
    }

    @Test
    fun fallsBackToUpiIdWhenThereIsNoToLine() {
        val parsed = GpayParser.parse("Pay ₹20.00\nswiggy@okhdfcbank")
        assertEquals(20.0, parsed.amount!!, 0.0001)
        assertEquals("swiggy@okhdfcbank", parsed.payee)
    }

    @Test
    fun returnsNullAmountWhenAbsent() {
        val parsed = GpayParser.parse("Enter your PIN\nTo Someone")
        assertNull(parsed.amount)
        assertEquals("Someone", parsed.payee)
    }
}
