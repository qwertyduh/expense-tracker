import ActivityKit
import AppIntents
import Foundation

/// Hand-off between the classifier and the Live Activity intent. Both run in the
/// app's process, so `UserDefaults.standard` is shared and needs no App Group.
///
/// The classifier writes the expense SMS here so the Shortcut never has to bind the
/// message text a second time (an empty second binding is the failure mode called out
/// in `docs/ios-shortcut-setup.md`). `ShowExpenseCaptureIntent` reads it back.
enum ExpenseCaptureBridge {
    static let stashedTextKey = "expense.capture.stashedSmsText"
    static let categoryMapKey = "expense.capture.merchantCategories"
    static let pendingKey = "expense.capture.pending"

    /// JS pushes the learned vendor → category map here (JSON object of
    /// normalized-vendor → category name) at launch and whenever it changes.
    static func setCategoryMap(json: String) {
        UserDefaults.standard.set(json, forKey: categoryMapKey)
    }

    /// Category name for a vendor, or nil when the vendor is not remembered.
    static func category(for merchant: String?) -> String? {
        guard let merchant, !merchant.isEmpty,
              let json = UserDefaults.standard.string(forKey: categoryMapKey),
              let data = json.data(using: .utf8),
              let map = try? JSONDecoder().decode([String: String].self, from: data)
        else { return nil }
        return map[normalize(merchant)]
    }

    /// Capsule captures that have been shown but not yet reviewed, confirmed, or
    /// auto-saved. A capture the user ignores/dismisses stays here and JS auto-logs
    /// it on the next foreground (`flushPendingCaptures`).
    static func pending() -> [String] {
        guard let json = UserDefaults.standard.string(forKey: pendingKey),
              let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return list
    }

    static func addPending(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var list = pending()
        guard !list.contains(trimmed) else { return }
        list.append(trimmed)
        persistPending(list)
    }

    static func removePending(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        persistPending(pending().filter { $0 != trimmed })
    }

    private static func persistPending(_ list: [String]) {
        guard let data = try? JSONEncoder().encode(list),
              let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(json, forKey: pendingKey)
    }

    /// Must mirror `normalizeMerchant` in `src/db/merchant-memory.ts` (and the
    /// `src/lib/merchant-category-sync.ts` copy): trim, collapse whitespace, lowercase.
    private static func normalize(_ merchant: String) -> String {
        merchant
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .lowercased()
    }
}

/// Phase 2 probe and the intended replacement for `OpenExpenseSMSIntent`.
///
/// Apple documents that an App Intent conforming to `LiveActivityIntent` — and only
/// that kind — may start a Live Activity while the app is *not* in the foreground,
/// because a system intent runs in the app's process (which iOS launches in the
/// background for this). The Shortcut runs this only when `Process Incoming SMS`
/// returned `true`, so an expense surfaces as a Dynamic Island capsule instead of
/// yanking the app forward.
///
/// The amount/vendor shown here come from `SmsDisplayParser`; the authoritative parse
/// and the save still happen in JS when the user taps through to the Add flow.
@available(iOS 17.0, *)
struct ShowExpenseCaptureIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Show Expense Capture"

    // Never bring the app forward — the whole point is an island instead of the app.
    static var openAppWhenRun: Bool = false

    /// Optional: leave unbound in the Shortcut (the classifier stashes the text), or
    /// bind `Shortcut Input` to override it when testing by hand.
    @Parameter(title: "Message Text")
    var messageText: String?

    func perform() async throws -> some IntentResult {
        // Replace any prior activity so repeated runs stay clean.
        for activity in Activity<ExpenseCaptureAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        let provided = messageText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let stashed = UserDefaults.standard.string(forKey: ExpenseCaptureBridge.stashedTextKey) ?? ""
        let raw = provided.isEmpty ? stashed : provided

        let display = SmsDisplayParser.parse(raw)
        let vendor = display.merchant ?? SmsDisplayParser.bankLabel(raw) ?? "New expense"
        let category = ExpenseCaptureBridge.category(for: display.merchant) ?? "Uncategorized"

        let state = ExpenseCaptureAttributes.ContentState(
            amount: display.amount,
            vendor: vendor,
            category: category,
            rawText: raw
        )
        let content = ActivityContent(
            state: state,
            staleDate: Date().addingTimeInterval(5 * 60)
        )

        // Propagate a failure rather than swallowing it: whether iOS permits this
        // background start is the core of the feature, so it should be visible.
        _ = try Activity.request(
            attributes: ExpenseCaptureAttributes(),
            content: content,
            pushType: nil
        )

        // Remember this capture until it is reviewed, confirmed, or auto-saved. If
        // the user dismisses the capsule without acting, JS auto-logs it on the next
        // foreground (`flushPendingCaptures`).
        ExpenseCaptureBridge.addPending(raw)
        return .result()
    }
}
