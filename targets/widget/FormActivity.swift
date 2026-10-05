import WidgetKit
import SwiftUI
import ActivityKit

// 1. Define the data we pass to the Island
struct FormActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var messageText: String
    }
}

// 2. Build the UI
struct FormActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FormActivityAttributes.self) { context in
            // Lock Screen UI
            Link(destination: URL(string: "abcapp://parse?text=\(context.state.messageText.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")")!) {
                VStack {
                    Text("New Form Ready")
                    Text("Tap to fill")
                }
            }
        } dynamicIsland: { context in
            // Dynamic Island UI
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    Link(destination: URL(string: "abcapp://parse?text=\(context.state.messageText.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")")!) {
                        Text("New Form Data Received! Tap to open.")
                    }
                }
            } compactLeading: {
                Text("📝")
            } compactTrailing: {
                Text("Ready")
            } minimal: {
                Text("📝")
            }
        }
    }
}
