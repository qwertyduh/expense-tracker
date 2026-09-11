package com.buildqwertyduh.expensetracker

import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Bridge for the app's Settings screen: reads/writes the detection pause state
 * and mode, and reports whether the accessibility service is enabled.
 */
class PaymentDetectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "PaymentDetection"

    @ReactMethod
    fun isEnabled(promise: Promise) {
        promise.resolve(PaymentPrefs.isEnabled(reactApplicationContext))
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        PaymentPrefs.setEnabled(reactApplicationContext, enabled)
        promise.resolve(true)
    }

    @ReactMethod
    fun getMode(promise: Promise) {
        promise.resolve(PaymentPrefs.mode(reactApplicationContext))
    }

    @ReactMethod
    fun setMode(mode: String, promise: Promise) {
        PaymentPrefs.setMode(reactApplicationContext, mode)
        promise.resolve(true)
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        val context = reactApplicationContext
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ).orEmpty()
        val pkg = context.packageName
        val short = "$pkg/.PaymentAccessibilityService"
        val full = "$pkg/${PaymentAccessibilityService::class.java.name}"
        val on = enabledServices.split(':').any {
            it.equals(short, ignoreCase = true) || it.equals(full, ignoreCase = true)
        }
        promise.resolve(on)
    }
}
