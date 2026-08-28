import SwiftUI

@main
struct NPPRetailApp: App {
    var body: some Scene {
        WindowGroup {
            RetailWebView(url: URL(string: "https://retail.nguyenlieuhungphat.com")!)
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }
}
