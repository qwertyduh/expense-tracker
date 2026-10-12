import ActivityKit
import AppIntents
import Foundation
#if canImport(ExpoAppIntents)
internal import ExpoAppIntents
#endif

/// The capsule's **Save** button (app-target copy).
///
/// Duplicated at `targets/widget/SaveExpenseCaptureIntent.swift` — the widget target
/// needs the type to build `Button(intent:)`, and Apple's documented sharing pattern
/// is one file compiled into both targets. `LiveActivityIntent` runs in the app's
/// process, so the app-target copy does the work; the `#if canImport` guard keeps the
/// Expo bridge out of the widget build. Keep both copies in sync.
///
/// Save ends the capsule at once and hands the expense to JS. If JS is cold, the
/// dispatch queues and drains on the next launch — never lost, at worst late.
@available(iOS 17.0, *)
struct SaveExpenseCaptureIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Save Expense"

    // Never foreground the app — Save is meant to be one tap on the capsule.
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Message Text")
    var messageText: String?

    func perform() async throws -> some IntentResult {
        // Dismiss every capture capsule immediately, whatever happens below.
        for activity in Activity<ExpenseCaptureAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        let provided = messageText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Literal (not `ExpenseCaptureBridge.stashedTextKey`) so this file compiles in
        // the widget target too; it mirrors that constant.
        let stashed = UserDefaults.standard.string(forKey: "expense.capture.stashedSmsText") ?? ""
        let raw = provided.isEmpty ? stashed : provided

        #if canImport(ExpoAppIntents)
        // App-process copy. Remove the pending capture first so the ignore/dismiss
        // reconcile can't also log this same SMS.
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
