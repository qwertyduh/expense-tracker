import AppIntents
import Foundation
internal import ExpoAppIntents

/// Background half of the SMS capture pair, and the Shortcut's first action.
/// It never brings the app up (`openAppWhenRun = false`), but it does persist an
/// invocation for the app. Expenses persist a `processSms` invocation and return
/// `true`; the Shortcut then runs `OpenExpenseSMSIntent`, which brings the app
/// forward so JS can route to /add. Credits persist a `processSmsIncoming`
/// invocation and still return `false`, so the app is never opened — a credit can
/// arrive while the phone is locked. That queued invocation IS the cache: JS
/// drains it on the next app launch. Rejected and unknown messages dispatch
/// nothing and return `false`.
struct ProcessSMSIntent: AppIntent {
    static var title: LocalizedStringResource = "Process Incoming SMS"
    static var openAppWhenRun: Bool = false   // silent background classification

    @Parameter(title: "Message Text")
    var messageText: String

    func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
        if isRejected(text: messageText) {
            // OTP / statement: never opens the app — the Shortcut's If sees false.
            return .result(value: false)
        }

        // Only a real expense reaches the JS Add Expense path. Dispatch from here
        // (not from the foreground intent) so the raw text is wired once and the
        // invocation is queued even if the app is not running yet.
        if isExpense(text: messageText) {
            await AppIntentDispatcher.shared.dispatch(
                name: "processSms",
                params: ["text": .string(messageText)]
            )
            return .result(value: true)
        }

        if isCredit(text: messageText) {
            // Money in. Queue it for JS but return false so the Shortcut never
            // opens the app — the message may arrive while the phone is locked.
            // The persisted invocation is the cache; JS drains it on the next
            // app launch.
            await AppIntentDispatcher.shared.dispatch(
                name: "processSmsIncoming",
                params: ["text": .string(messageText)]
            )
            return .result(value: false)
        }

        return .result(value: false)
    }

    private func isExpense(text: String) -> Bool {
        // Mirror of DEBIT_AMOUNT_PATTERNS in src/parsers/sms.ts — default-deny.
        // Each alternative carries BOTH the debit verb and the amount, so a
        // stray figure (a balance) or an unanchored verb (a future EMI "will be
        // debited") can't pass. Keep this in sync when the parser changes.
        let patterns = [
            #"(?:Rs\.?|INR|₹)\s?[\d,]+(?:\.\d+)?\s*(?:has\s+been\s+|is\s+|was\s+)?(?:debited|deducted|withdrawn|charged)\b"#,
            #"\b(?:Sent|Spent|You\s+paid|Paid|Debited|Deducted|Withdrawn|Charged|Transferred)\b[^.\n]{0,40}?(?:Rs\.?|INR|₹)\s?[\d,]"#,
            #"(?m)^Pay\s+(?:Rs\.?|INR|₹)\s?[\d,]"#,
        ]
        return patterns.contains { text.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }

    private func isCredit(text: String) -> Bool {
        // Mirror of CREDIT_AMOUNT_PATTERNS in src/parsers/sms.ts — default-deny.
        // Like isExpense, each alternative carries BOTH the credit verb and the
        // amount. A credit never opens the app: the classifier only queues the
        // invocation. Keep this in sync when the parser changes.
        let patterns = [
            #"(?:Rs\.?|INR|₹)\s?[\d,]+(?:\.\d+)?\s*(?:has\s+been\s+|is\s+|was\s+)?(?:credited|received|deposited|refunded|added)\b"#,
            #"\bcredited\s+with\s+(?:Rs\.?|INR|₹)\s?[\d,]+"#,
            #"\b(?:Received|Credited|Deposited|Refunded|You\s+received)\b[^.\n]{0,40}?(?:Rs\.?|INR|₹)\s?[\d,]"#,
        ]
        return patterns.contains { text.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }

    private func isRejected(text: String) -> Bool {
        // Mirror of REJECT_PATTERNS in src/parsers/sms.ts. These are the only
        // messages that carry a debit verb and an amount yet are not one
        // transaction, so they are checked before the expense gate.
        let pattern = #"\botp\b|one[\s-]?time\s+password|verification\s+code|do\s+not\s+share|mini[\s-]?statement|account\s+statement|e[\s-]?statement"#
        return text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

/// Foreground half of the pair. It has no parameters and does no work: the
/// classifier has already dispatched the text. Its only job is to bring the app
/// up (`openAppWhenRun = true`), which the Shortcut does solely when the
/// classifier returned `true`. On launch, `useAppIntents` drains the queued
/// `processSms` invocation, `parseAnySms` parses it, and the Add flow opens
/// pre-filled.
struct OpenExpenseSMSIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Expense from SMS"
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        return .result()
    }
}
