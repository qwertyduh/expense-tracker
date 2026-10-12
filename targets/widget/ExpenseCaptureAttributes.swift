import ActivityKit
import Foundation

/// Shape of the expense-capture Live Activity (widget-target copy).
///
/// Duplicated on purpose from `app-intents/ExpenseCaptureAttributes.swift`. The activity
/// is started by the app target and rendered by this widget target, and each target only
/// compiles its own folder, so the type is declared in both. ActivityKit matches an
/// activity by the attributes type **name** and the Codable shape of its `ContentState`,
/// so both copies must keep the same type name and property names. Change both together.
struct ExpenseCaptureAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var amount: String
        var vendor: String
        var category: String
        var rawText: String
    }
}
