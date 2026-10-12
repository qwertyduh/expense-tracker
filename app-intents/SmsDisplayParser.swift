import Foundation

/// Read-only mirror of the amount/merchant slices of `parseAnySms` in
/// `src/parsers/sms.ts`, used only to fill the Live Activity's display fields.
///
/// This is *not* a second decision-maker: whether a message is an expense at all
/// is `ProcessSMSIntent`'s gate, and the authoritative parse still happens in JS on
/// the Add screen. If these patterns drift, the worst case is a capsule that shows a
/// blank or stale amount — never a wrong save. Keep in sync when the parser changes.
enum SmsDisplayParser {
    struct Display {
        let amount: String
        let merchant: String?
    }

    private static let reject = try! NSRegularExpression(
        pattern: #"\botp\b|one[\s-]?time\s+password|verification\s+code|do\s+not\s+share|mini[\s-]?statement|account\s+statement|e[\s-]?statement"#,
        options: [.caseInsensitive]
    )

    // Mirror of DEBIT_AMOUNT_PATTERNS; group 1 is the amount.
    private static let amountPatterns: [NSRegularExpression] = [
        #"(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)\s*(?:has\s+been\s+|is\s+|was\s+)?(?:debited|deducted|withdrawn|charged)\b"#,
        #"\b(?:Sent|Spent|You\s+paid|Paid|Debited|Deducted|Withdrawn|Charged|Transferred)\b[^.\n]{0,40}?(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)"#,
        #"^Pay\s+(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)\s*$"#,
    ].map { try! NSRegularExpression(pattern: $0, options: [.caseInsensitive, .anchorsMatchLines]) }

    // Mirror of MERCHANT_PATTERNS; group 1 is the merchant label.
    private static let merchantPatterns: [NSRegularExpression] = [
        #"To\s+([^\n,]+?)\s+with\s+txn\s+ID"#,
        #"To\s+([^\n]+?)\s+(?:\n\s*)?On"#,
        #"At\s+(.+?)\s+On\s+\d"#,
        #"^To\s+(.+)$"#,
    ].map { try! NSRegularExpression(pattern: $0, options: [.caseInsensitive, .anchorsMatchLines]) }

    /// Returns display-ready amount ("₹49" / "₹49.50") and merchant, best effort.
    static func parse(_ raw: String) -> Display {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let merchant = firstGroup(merchantPatterns, in: text)
        let range = NSRange(text.startIndex..<text.endIndex, in: text)

        if reject.firstMatch(in: text, options: [], range: range) == nil,
           let amount = firstGroup(amountPatterns, in: text) {
            return Display(amount: format(amount), merchant: merchant)
        }

        return Display(amount: "Expense", merchant: merchant)
    }

    /// Mirror of `detectBankHint`, for a vendor fallback when no merchant matched.
    static func bankLabel(_ raw: String) -> String? {
        let text = raw
        if text.range(of: "HDFC", options: .caseInsensitive) != nil { return "HDFC" }
        if text.range(of: "FamApp|FamPay", options: [.regularExpression, .caseInsensitive]) != nil { return "FamApp" }
        if text.range(of: "GPay|Google Pay|Pay ₹", options: [.regularExpression, .caseInsensitive]) != nil { return "GPay" }
        return nil
    }

    private static func firstGroup(_ patterns: [NSRegularExpression], in text: String) -> String? {
        let full = NSRange(text.startIndex..<text.endIndex, in: text)
        for pattern in patterns {
            guard let match = pattern.firstMatch(in: text, options: [], range: full),
                  match.numberOfRanges > 1,
                  let groupRange = Range(match.range(at: 1), in: text) else { continue }
            let value = String(text[groupRange]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { return value }
        }
        return nil
    }

    private static func format(_ rawAmount: String) -> String {
        let number = Double(rawAmount.replacingOccurrences(of: ",", with: "")) ?? 0
        let isWhole = number.truncatingRemainder(dividingBy: 1) == 0
        return "₹" + (isWhole ? String(Int(number)) : String(format: "%.2f", number))
    }
}
