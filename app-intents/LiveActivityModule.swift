import ActivityKit
internal import ExpoModulesCore
import Foundation

/// Bridges the Live Activity capture to JS: ends capsules, and relays the learned
/// vendor → category map and the pending-capture list. The activity itself is started
/// by `ShowExpenseCaptureIntent` (a background `LiveActivityIntent`), not from here.
final class LiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LiveActivity")

        /// Ends every expense-capture activity. Returns how many were ended.
        AsyncFunction("endAllActivities") { () async -> Int in
            var ended = 0
            for activity in Activity<ExpenseCaptureAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
                ended += 1
            }
            return ended
        }

        /// Persists the learned vendor → category map (JSON) for
        /// `ShowExpenseCaptureIntent` to read while the app is in the background.
        AsyncFunction("setMerchantCategoryMap") { (json: String) in
            ExpenseCaptureBridge.setCategoryMap(json: json)
        }

        /// Raw SMS texts of capsules shown but not yet reviewed, confirmed, or
        /// auto-saved. Synchronous so `flushPendingCaptures` can run before the first
        /// screen reads the database on a cold start.
        Function("getPendingCaptures") { () -> [String] in
            ExpenseCaptureBridge.pending()
        }

        /// Drops one pending capture. Synchronous for the same reason.
        Function("removePendingCapture") { (text: String) in
            ExpenseCaptureBridge.removePending(text)
        }
    }
}
