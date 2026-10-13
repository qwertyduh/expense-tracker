import ActivityKit
import Foundation

// NOTE: This exact file exists at BOTH `app-intents/ExpenseCaptureAttributes.swift`
// and `targets/widget/ExpenseCaptureAttributes.swift`. The app target starts the Live
// Activity and the widget target renders it, and `@bacons/apple-targets` links each
// folder to exactly one target, so there is no shared source folder. ActivityKit
// matches an activity by the attributes type name and the Codable shape of its
// `ContentState`. `scripts/check-swift-parity.sh` (run by `npm test`) fails if the two
// copies differ.

/// Shape of the expense-capture Live Activity.
struct ExpenseCaptureAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Display amount, already formatted (e.g. "₹49").
        var amount: String
        /// Merchant/vendor label extracted from the SMS.
        var vendor: String
        /// Category name, resolved from the learned vendor → category map.
        var category: String
        /// Raw SMS text, carried so a tap can deep-link back into the Add flow.
        var rawText: String
    }
}
