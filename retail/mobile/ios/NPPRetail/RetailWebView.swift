import SwiftUI
import UIKit
import WebKit

struct RetailWebView: UIViewRepresentable {
    let url: URL

    final class Coordinator: NSObject, WKNavigationDelegate {
        var bridge: RetailPrinterBridge?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if target.scheme == "https" || target.scheme == "http" || target.scheme == "about" {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.bridge = RetailPrinterBridge.install(on: webView)
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
