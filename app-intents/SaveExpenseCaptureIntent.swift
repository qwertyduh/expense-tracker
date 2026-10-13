import ActivityKit
import AppIntents
import Foundation
#if canImport(ExpoAppIntents)
internal import ExpoAppIntents
#endif

// NOTE: This exact file exists at BOTH `app-intents/SaveExpenseCaptureIntent.swift`
// and `targets/widget/SaveExpenseCaptureIntent.swift`. The widget target needs the type
// to build `Button(intent:)`; `LiveActivityIntent` runs in the app's process, so the
// app-target copy performs the work, and `#if canImport(ExpoAppIntents)` keeps the Expo
// bridge out of the widget build. `scripts/check-swift-parity.sh` (run by `npm test`)
// fails if the two copies differ.

/// The capsule's **Save** button. Ends the capsule at once and hands the expense to JS;
/// if JS is cold the dispatch queues and drains on the next launch — never lost.
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
        // Literal (not `ExpenseCaptureBridge.stashedTextKey`) so this file also compiles
        // in the widget target, where that type is absent; it mirrors the constant.
        let stashed = UserDefaults.standard.string(forKey: "expense.capture.stashedSmsText") ?? ""
        let raw = provided.isEmpty ? stashed : provided

        #if canImport(ExpoAppIntents)
        // App-process copy. Queue the save first, then drop the pending capture, so a
        // crash in between can't both remove the pending entry and lose the dispatch.
        if !raw.isEmpty {
            await AppIntentDispatcher.shared.dispatch(
                name: "processSmsSave",
                params: ["text": .string(raw)]
            )
        }
        ExpenseCaptureBridge.removePending(raw)
        #else
        // Widget-extension copy (no Expo bridge): leave the pending capture in place
        // so the app logs it on next launch. Nothing is lost either way.
        _ = raw
        #endif

        return .result()
    }
}
