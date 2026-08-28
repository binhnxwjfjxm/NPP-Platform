import Foundation
import Network
import UIKit
import WebKit

final class RetailPrinterBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "retailPrinter"
    private weak var webView: WKWebView?
    private let printerQueue = DispatchQueue(label: "com.nguyenlieuhungphat.retail.printer")

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    static func install(on webView: WKWebView) -> RetailPrinterBridge {
        let bridge = RetailPrinterBridge(webView: webView)
        let controller = webView.configuration.userContentController
        controller.add(bridge, name: handlerName)
        controller.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        return bridge
    }

    static let bridgeScript = #"""
    (() => {
      const pending = new Map();
      let counter = 0;
      window.__retailPrinterResolve = (id, response) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        clearTimeout(item.timer);
        item.resolve(response);
      };
      window.RetailPrinterBridge = {
        version: '1',
        request(request) {
          return new Promise((resolve) => {
            const id = `retail-printer-${Date.now()}-${++counter}`;
            const timer = setTimeout(() => {
              pending.delete(id);
              resolve({ ok: false, code: 'PRINT_STATUS_UNKNOWN', message: 'Máy in phản hồi quá lâu. Hãy kiểm tra phiếu trước khi in lại.', safeToFallback: false });
            }, 12000);
            pending.set(id, { resolve, timer });
            window.webkit.messageHandlers.retailPrinter.postMessage({ id, action: request.action, payload: request.payload ?? null });
          });
        }
      };
    })();
    """#

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let action = body["action"] as? String else { return }
        let payload = body["payload"]
        switch action {
        case "capabilities":
            reply(id: id, value: [
                "ok": true,
                "data": [
                    "version": "ios-1",
                    "directWifi": true,
                    "discovery": true,
                    "manualIp": true,
                    "protocols": ["ESC_POS"],
                    "cashDrawer": false
                ]
            ])
        case "discover": discover(id: id)
        case "test": sendPrint(id: id, payload: payload, isTest: true)
        case "print": sendPrint(id: id, payload: payload, isTest: false)
        case "forget": reply(id: id, value: ["ok": true, "data": [:]])
        default:
            reply(id: id, value: ["ok": false, "code": "UNKNOWN_ACTION", "message": "Thao tác máy in chưa được hỗ trợ.", "safeToFallback": true])
        }
    }

    private func discover(id: String) {
        // _pdl-datastream._tcp is the Bonjour raw-print stream used by many LAN printers.
        // Do not treat LPD/IPP service ports as raw ESC/POS endpoints.
        let browser = NWBrowser(for: .bonjour(type: "_pdl-datastream._tcp", domain: nil), using: .tcp)
        let lock = NSLock()
        var profiles: [[String: Any]] = []
        browser.browseResultsChangedHandler = { results, _ in
            let rows: [[String: Any]] = results.compactMap { result in
                guard case let .service(name, serviceType, domain, _) = result.endpoint else { return nil }
                return [
                    "id": "bonjour:\(serviceType):\(name)",
                    "name": name,
                    "connectionType": "LAN",
                    "protocol": "ESC_POS",
                    "serviceName": name,
                    "serviceType": serviceType,
                    "serviceDomain": domain,
                    "paper": "80mm",
                    "lastVerifiedStatus": "UNKNOWN"
                ]
            }
            lock.lock()
            profiles = rows
            lock.unlock()
        }
        browser.stateUpdateHandler = { state in
            if case .failed = state { browser.cancel() }
        }
        browser.start(queue: printerQueue)
        printerQueue.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            browser.cancel()
            lock.lock()
            let result = profiles.sorted { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
            lock.unlock()
            self?.reply(id: id, value: ["ok": true, "data": result])
        }
    }

    private func sendPrint(id: String, payload: Any?, isTest: Bool) {
        guard let root = payload as? [String: Any],
              let profile = root["profile"] as? [String: Any],
              let printPayload = root["payload"] as? [String: Any] else {
            reply(id: id, value: ["ok": false, "code": "INVALID_PRINT_PAYLOAD", "message": "Dữ liệu in chưa hợp lệ.", "safeToFallback": true])
            return
        }
        guard (profile["protocol"] as? String ?? "ESC_POS") == "ESC_POS" else {
            reply(id: id, value: ["ok": false, "code": "UNSUPPORTED_PRINTER", "message": "Máy in này chưa được hỗ trợ để in trực tiếp.", "safeToFallback": true])
            return
        }

        let endpoint: NWEndpoint?
        if let host = profile["host"] as? String, !host.isEmpty {
            let portNumber = (profile["port"] as? NSNumber)?.uint16Value ?? 9100
            endpoint = NWEndpoint.Port(rawValue: portNumber).map { .hostPort(host: NWEndpoint.Host(host), port: $0) }
        } else if let name = profile["serviceName"] as? String,
                  let type = profile["serviceType"] as? String {
            endpoint = .service(name: name, type: type, domain: profile["serviceDomain"] as? String ?? "local.", interface: nil)
        } else {
            endpoint = nil
        }

        guard let endpoint else {
            reply(id: id, value: ["ok": false, "code": "PRINTER_NOT_SELECTED", "message": "Chưa có địa chỉ máy in.", "safeToFallback": true])
            return
        }

        let paper = (printPayload["paper"] as? String) ?? (profile["paper"] as? String) ?? "80mm"
        guard paper == "80mm" || paper == "58mm" else {
            reply(id: id, value: ["ok": false, "code": "DIRECT_PAPER_UNSUPPORTED", "message": "In Wi‑Fi trực tiếp hiện hỗ trợ khổ 80 mm và 58 mm.", "safeToFallback": true])
            return
        }
        let copies = max(1, min(5, (printPayload["copies"] as? NSNumber)?.intValue ?? 1))
        guard let page = EscPosRenderer.render(payload: printPayload, paper: paper) else {
            reply(id: id, value: ["ok": false, "code": "PRINT_RENDER_FAILED", "message": "Chưa thể tạo phiếu in.", "safeToFallback": true])
            return
        }
        var job = Data()
        for _ in 0..<copies { job.append(page) }
        send(job: job, to: endpoint, id: id, copies: copies, isTest: isTest)
    }

    private func send(job: Data, to endpoint: NWEndpoint, id: String, copies: Int, isTest: Bool) {
        let connection = NWConnection(to: endpoint, using: .tcp)
        let lock = NSLock()
        var completed = false
        var sendStarted = false

        func markSendStarted() {
            lock.lock()
            sendStarted = true
            lock.unlock()
        }
        func hasSendStarted() -> Bool {
            lock.lock()
            let value = sendStarted
            lock.unlock()
            return value
        }
        func finish(_ value: [String: Any]) {
            lock.lock()
            guard !completed else { lock.unlock(); return }
            completed = true
            lock.unlock()
            connection.cancel()
            self.reply(id: id, value: value)
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                markSendStarted()
                connection.send(content: job, completion: .contentProcessed { error in
                    if let error {
                        finish(["ok": false, "code": "PRINT_SEND_FAILED", "message": "Không xác nhận được phiếu đã in: \(error.localizedDescription). Hãy kiểm tra máy trước khi in lại.", "safeToFallback": false])
                    } else if isTest {
                        finish(["ok": true, "data": ["verifiedAt": ISO8601DateFormatter().string(from: Date())]])
                    } else {
                        finish(["ok": true, "data": ["printedCopies": copies]])
                    }
                })
            case let .failed(error):
                let safe = !hasSendStarted()
                finish(["ok": false, "code": safe ? "PRINTER_OFFLINE" : "PRINT_STATUS_UNKNOWN", "message": safe ? "Không kết nối được máy in: \(error.localizedDescription)" : "Mất kết nối sau khi đã gửi phiếu. Hãy kiểm tra máy trước khi in lại.", "safeToFallback": safe])
            case .cancelled:
                break
            default:
                break
            }
        }
        connection.start(queue: printerQueue)
        printerQueue.asyncAfter(deadline: .now() + 6) {
            let safe = !hasSendStarted()
            finish(["ok": false, "code": safe ? "PRINTER_TIMEOUT" : "PRINT_STATUS_UNKNOWN", "message": safe ? "Máy in không phản hồi. Hãy kiểm tra Wi‑Fi và nguồn máy in." : "Chưa xác nhận được kết quả in. Hãy kiểm tra phiếu trước khi in lại.", "safeToFallback": safe])
        }
    }

    private func reply(id: String, value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else { return }
        let encodedId = id.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.__retailPrinterResolve && window.__retailPrinterResolve('\(encodedId)', \(json));")
        }
    }
}

private enum EscPosRenderer {
    static func render(payload: [String: Any], paper: String) -> Data? {
        let width = paper == "58mm" ? 384 : 576
        guard let image = renderText(printableText(payload), width: width), let raster = rasterBytes(image) else { return nil }
        let widthBytes = (image.width + 7) / 8
        var output = Data([0x1B, 0x40])
        output.append(contentsOf: [0x1D, 0x76, 0x30, 0x00, UInt8(widthBytes & 0xFF), UInt8((widthBytes >> 8) & 0xFF), UInt8(image.height & 0xFF), UInt8((image.height >> 8) & 0xFF)])
        output.append(raster)
        output.append(contentsOf: [0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00])
        return output
    }

    private static func printableText(_ payload: [String: Any]) -> String {
        var lines: [String] = []
        if let heading = payload["heading"] as? String, !heading.isEmpty { lines.append(heading) }
        if let title = payload["title"] as? String, !title.isEmpty { lines.append(title) }
        if let subtitle = payload["subtitle"] as? String, !subtitle.isEmpty { lines.append(subtitle) }
        if let number = payload["documentNumber"] as? String, !number.isEmpty { lines.append(number) }
        lines.append(String(repeating: "-", count: 32))
        if let meta = payload["meta"] as? [[String: Any]] {
            for item in meta { lines.append("\(item["label"] as? String ?? ""): \(item["value"] as? String ?? "")") }
        }
        if let columns = payload["columns"] as? [String], !columns.isEmpty {
            lines.append(String(repeating: "-", count: 32))
            lines.append(columns.joined(separator: " | "))
        }
        if let rows = payload["rows"] as? [[String]] {
            for row in rows { lines.append(row.joined(separator: " | ")) }
        }
        if let totals = payload["totals"] as? [[String: Any]], !totals.isEmpty {
            lines.append(String(repeating: "-", count: 32))
            for item in totals { lines.append("\(item["label"] as? String ?? ""): \(item["value"] as? String ?? "")") }
        }
        if let footer = payload["footer"] as? [String], !footer.isEmpty {
            lines.append("")
            lines.append(contentsOf: footer)
        }
        return lines.joined(separator: "\n")
    }

    private static func renderText(_ text: String, width: Int) -> CGImage? {
        let horizontalPadding: CGFloat = 18
        let fontSize: CGFloat = width <= 384 ? 20 : 23
        let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineSpacing = 3
        let attributed = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: UIColor.black, .paragraphStyle: paragraph])
        let targetWidth = CGFloat(width) - horizontalPadding * 2
        let bounds = attributed.boundingRect(with: CGSize(width: targetWidth, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        let height = Int(ceil(bounds.height + 30))
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: CGFloat(width), height: CGFloat(max(1, height))))
        let image = renderer.image { context in
            let cg = context.cgContext
            cg.setFillColor(UIColor.white.cgColor)
            cg.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(max(1, height))))
            attributed.draw(with: CGRect(x: horizontalPadding, y: 12, width: targetWidth, height: bounds.height + 4), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        }
        return image.cgImage
    }

    private static func rasterBytes(_ image: CGImage) -> Data? {
        let width = image.width
        let height = image.height
        let bytesPerRow = width * 4
        var rgba = [UInt8](repeating: 255, count: height * bytesPerRow)
        guard let context = CGContext(data: &rgba, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let widthBytes = (width + 7) / 8
        var data = Data(capacity: widthBytes * height)
        for y in 0..<height {
            for byteIndex in 0..<widthBytes {
                var value: UInt8 = 0
                for bit in 0..<8 {
                    let x = byteIndex * 8 + bit
                    guard x < width else { continue }
                    let offset = y * bytesPerRow + x * 4
                    let luminance = (Int(rgba[offset]) * 30 + Int(rgba[offset + 1]) * 59 + Int(rgba[offset + 2]) * 11) / 100
                    if luminance < 170 { value |= UInt8(0x80 >> bit) }
                }
                data.append(value)
            }
        }
        return data
    }
}
