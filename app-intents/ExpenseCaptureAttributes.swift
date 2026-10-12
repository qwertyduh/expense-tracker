import ActivityKit
import Foundation

/// Shape of the expense-capture Live Activity (app-target copy).
///
/// This file is intentionally duplicated at
/// `targets/widget/ExpenseCaptureAttributes.swift`. The activity is *started* by the
/// app target and *rendered* by the widget target, and `@bacons/apple-targets` links
/// each folder to exactly one target, so there is no shared source folder. ActivityKit
/// matches an activity by the attributes type **name** and the Codable shape of its
/// `ContentState`, so both copies must keep the same type name and the same property
/// names. Change both together.
struct ExpenseCaptureAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Display amount, already formatted (e.g. "₹49.00").
        var amount: String
        /// Merchant/vendor label extracted from the SMS.
        var vendor: String
        /// Category name — Phase 1 sends a placeholder; later phases resolve it.
        var category: String
        /// Raw SMS text, carried so a tap can deep-link back into the Add flow.
        var rawText: String
    }
}
