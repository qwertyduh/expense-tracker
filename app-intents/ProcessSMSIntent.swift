import AppIntents
import ActivityKit
import Foundation
import ExpoAppIntents

struct ProcessSMSIntent: AppIntent {
    static var title: LocalizedStringResource = "Process Incoming SMS"
    static var openAppWhenRun: Bool = false   // silent background classification

    @Parameter(title: "Message Text")
    var messageText: String

    func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
        let isPayment = isPayment(text: messageText)
        
        // Still launch the Dynamic Island if it's a payment and activities are enabled
        if isPayment && ActivityAuthorizationInfo().areActivitiesEnabled {
            let attributes = FormActivityAttributes()
            let contentState = FormActivityAttributes.ContentState(messageText: messageText)
            
            do {
                _ = try Activity<FormActivityAttributes>.request(
                    attributes: attributes,
                    contentState: contentState,
                    pushType: nil
                )
            } catch {
                print("Failed to launch activity: \(error.localizedDescription)")
            }
        }
        
        // Dispatch raw text to JS so the existing parseAnySms + Add Expense path keeps working
        await AppIntentDispatcher.shared.dispatch(
            name: "processSms",
            params: ["text": .string(messageText)]
        )
        
        return .result(value: isPayment)
    }
    
    private func isPayment(text: String) -> Bool {
        // Mirror of AMOUNT_PATTERNS in src/parsers/sms.ts — a payment has a real amount.
        text.range(of: #"Rs\.?\s?\d|₹\s?\d|Sent Rs|Spent Rs|paid Rs"#, options: .regularExpression) != nil
    }
}
