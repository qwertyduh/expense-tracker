import ActivityKit
internal import ExpoModulesCore
import Foundation

/// Phase 1 debug bridge: lets the app start a throwaway expense-capture Live Activity
/// from a settings button, so we can prove the Dynamic Island renders before wiring any
/// SMS/Shortcut plumbing. This module is a probe — later phases either extend it (to
/// carry parsed amount/vendor/category and deep-link back into Add) or replace it with
/// the background `LiveActivityIntent`.
final class LiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LiveActivity")

        /// Starts (or restarts) the expense-capture activity and returns its id.
        AsyncFunction("startTestActivity") { (amount: String, vendor: String, category: String) -> String in
            // Replace any prior activity so repeated taps stay clean.
            for activity in Activity<ExpenseCaptureAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }

            let attributes = ExpenseCaptureAttributes()
            let state = ExpenseCaptureAttributes.ContentState(
                amount: amount,
                vendor: vendor,
                category: category,
                rawText: ""
            )
            // Mark it stale after 5 minutes. iOS caps the active window at ~8h; this
            // only tells the system the data is old, it does not end it.
            let content = ActivityContent(
                state: state,
                staleDate: Date().addingTimeInterval(5 * 60)
            )

            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )

            // Phase 1 convenience: end it after 5 minutes while the app process is
            // alive. There is no public "end at time T" API, so the real background
            // flow will rely on staleDate + reconcile-on-foreground instead.
            Task {
                try? await Task.sleep(for: .seconds(5 * 60))
                await activity.end(nil, dismissalPolicy: .default)
            }

            return activity.id
        }

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
        /// auto-saved. JS flushes these on foreground (ignored/dismissed captures).
        AsyncFunction("getPendingCaptures") { () -> [String] in
            ExpenseCaptureBridge.pending()
        }

        /// Drops one pending capture, e.g. when the user taps Edit or confirms.
        AsyncFunction("removePendingCapture") { (text: String) in
            ExpenseCaptureBridge.removePending(text)
        }
    }
}
