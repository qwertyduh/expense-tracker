import ActivityKit
import SwiftUI
import WidgetKit

/// Renders the expense-capture Live Activity in the Dynamic Island and on the Lock
/// Screen. **Edit** (left) deep-links into the Add flow; **Save** (right) commits the
/// expense and dismisses the capsule without opening the app.
struct ExpenseCaptureActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ExpenseCaptureAttributes.self) { context in
            // Lock Screen / banner presentation.
            HStack(spacing: 12) {
                Link(destination: reviewURL(context.state.rawText)) {
                    HStack(spacing: 12) {
                        Image(systemName: "indianrupeesign.circle.fill")
                            .font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(context.state.vendor.isEmpty ? "New expense" : context.state.vendor)
                                .font(.headline)
                                .lineLimit(1)
                            Text("\(context.state.amount) · \(categoryLabel(context.state.category))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 0)
                Button(intent: saveIntent(context.state.rawText)) {
                    Text("Save")
                        .font(.subheadline.bold())
                }
                .buttonStyle(.plain)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.amount)
                        .font(.title3.bold())
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(categoryLabel(context.state.category))
                        .font(.caption)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center) {
                        // Edit — bottom left.
                        Link(destination: reviewURL(context.state.rawText)) {
                            Label("Edit", systemImage: "pencil")
                                .font(.caption2.bold())
                        }
                        Spacer(minLength: 0)
                        // Save — bottom right.
                        Button(intent: saveIntent(context.state.rawText)) {
                            Label("Save", systemImage: "checkmark.circle.fill")
                                .font(.caption2.bold())
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity)
                }
            } compactLeading: {
                Text(context.state.amount)
                    .font(.caption2)
                    .lineLimit(1)
            } compactTrailing: {
                Image(systemName: "indianrupeesign.circle.fill")
                    .font(.caption2)
            } minimal: {
                Image(systemName: "indianrupeesign.circle.fill")
            }
            .widgetURL(reviewURL(context.state.rawText))
        }
    }
}

private func categoryLabel(_ category: String) -> String {
    category.isEmpty ? "Uncategorized" : category
}

/// Save runs `SaveExpenseCaptureIntent` with the raw SMS bound, so it works even if
/// the app never stashed the text (e.g. a manual test).
private func saveIntent(_ rawText: String) -> SaveExpenseCaptureIntent {
    let intent = SaveExpenseCaptureIntent()
    intent.messageText = rawText
    return intent
}

/// Deep link back into the Add flow. Percent-encodes everything outside the RFC 3986
/// unreserved set, so `&`, `=`, `+` and `%` in a bank SMS can't corrupt the query;
/// JS decodes the value with `decodeURIComponent`.
private func reviewURL(_ rawText: String) -> URL {
    let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
    )
    let encoded = rawText.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    return URL(string: "expensetracker://add?data=" + encoded)
        ?? URL(string: "expensetracker://")!
}
