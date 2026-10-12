import ActivityKit
import AppIntents
import Foundation
#if canImport(ExpoAppIntents)
internal import ExpoAppIntents
#endif

/// The capsule's **Save** button (widget-target copy).
///
/// Duplicated from `app-intents/SaveExpenseCaptureIntent.swift` so the widget target
/// can build `Button(intent:)`; the app-target copy performs the work because
/// `LiveActivityIntent` runs in the app's process. The `#if canImport` guard keeps the
/// Expo bridge (app-target only) out of this build. Keep both copies in sync.
@available(iOS 17.0, *)
struct SaveExpenseCaptureIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Save Expense"

    static var openAppWhenRun: Bool = false

    @Parameter(title: "Message Text")
    var messageText: String?

    func perform() async throws -> some IntentResult {
        for activity in Activity<ExpenseCaptureAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        let provided = messageText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Literal (not `ExpenseCaptureBridge.stashedTextKey`) so this file compiles in
        // the widget target too; it mirrors that constant.
        let stashed = UserDefaults.standard.string(forKey: "expense.capture.stashedSmsText") ?? ""
        let raw = provided.isEmpty ? stashed : provided

        #if canImport(ExpoAppIntents)
        ExpenseCaptureBridge.removePending(raw)
        if !raw.isEmpty {
            await AppIntentDispatcher.shared.dispatch(
                name: "processSmsSave",
                params: ["text": .string(raw)]
            )
        }
        #else
        // Widget-extension copy (no Expo bridge): leave the pending capture in place
        // so the app logs it on next launch. Nothing is lost either way.
        _ = raw
        #endif

        return .result()
    }
}
