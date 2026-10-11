import SwiftUI
import WebKit
import UniformTypeIdentifiers
import UserNotifications

/// Shows the PetPost web app, which is bundled inside the iPhone app in the "Web" folder.
/// It is served from petpost://app/ (not file://) so the app's JavaScript modules load and its storage persists.
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}

final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let scheme = "petpost"
    private var webView: WKWebView!
    private let background = UIColor(red: 0.106, green: 0.122, blue: 0.231, alpha: 1)

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()   // keeps accounts, posts and photos between launches
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: Self.scheme)
        config.userContentController.add(WeakMessageHandler(self), name: "petpost")
        // An app shouldn't pinch-zoom or zoom in on text boxes like a website does.
        let noZoom = """
        document.querySelector('meta[name=viewport]')?.setAttribute('content',
          'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
        """
        config.userContentController.addUserScript(WKUserScript(source: noZoom, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the page handles the notch and home bar itself
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: URL(string: "\(Self.scheme)://app/index.html#/feed")!))
    }

    // MARK: Links

    // Web links (like Daybloom) open in Safari instead of replacing the app.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if let url = navigationAction.request.url,
           ["http", "https", "mailto"].contains(url.scheme ?? ""),
           navigationAction.targetFrame?.isMainFrame ?? true {
            await UIApplication.shared.open(url)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // The camera and microphone are covered by the iPhone's own permission prompt, so don't ask twice.
    func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
                 initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType) async -> WKPermissionDecision {
        .grant
    }

    // Keep the page's confirm() dialogs (like "Delete this post?") working inside the app.
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { done in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done.resume(returning: true) })
            present(alert, animated: true)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done.resume() })
            present(alert, animated: true)
        }
    }

    // The page was unloaded by the system (for example, low memory). Reload it.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    #if DEBUG
    // Test builds only: `simctl launch ... -PetPostDebugJS "<script>"` runs a script once the page loads
    // and logs what it returns, plus the notifications waiting to go off. Never part of the App Store build.
    private var ranDebugScript = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !ranDebugScript, let script = UserDefaults.standard.string(forKey: "PetPostDebugJS"), !script.isEmpty else { return }
        ranDebugScript = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                let text: String
                switch result {
                case .success(let value): text = String(describing: value)
                case .failure(let error): text = "ERROR \(error)"
                }
                NSLog("PETPOST_DEBUG result: %@", text)
                UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
                    let list = requests.map { "\($0.identifier) | \($0.content.title) | \($0.trigger.map { String(describing: $0) } ?? "")" }.joined(separator: " ;; ")
                    NSLog("PETPOST_DEBUG pending(%d): %@", requests.count, list)
                }
            }
        }
    }
    #endif

    // MARK: Messages from the web app

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "haptic":
            Haptics.play(body["style"] as? String ?? "light")
        case "tone":
            Appearance.shared.darkMode = (body["tone"] as? String) == "dark"
        case "care":
            let items = body["items"] as? [[String: Any]] ?? []
            let petName = body["pet"] as? String ?? "Your pet"
            let ask = body["ask"] as? Bool ?? false
            Task {
                let allowed = await CareReminders.schedule(items, petName: petName, ask: ask)
                _ = try? await webView.evaluateJavaScript("window.petpostNativeReminders && window.petpostNativeReminders(\(allowed))")
            }
        case "share":
            shareFile(base64: body["data"] as? String, name: body["name"] as? String ?? "PetPost",
                      text: body["text"] as? String)
        case "openSettings":
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        default:
            break
        }
    }

    /// Opens the iPhone share sheet for a photo or video from PetPost (Save Image, Messages, AirDrop...).
    private func shareFile(base64: String?, name: String, text: String?) {
        var items: [Any] = []
        if let base64, let data = Data(base64Encoded: base64) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try? data.write(to: url, options: .atomic)
            items.append(url)
        }
        if let text, !text.isEmpty { items.append(text) }
        guard !items.isEmpty else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(sheet, animated: true)
    }
}

/// Serves the files in the app bundle's "Web" folder at petpost://app/...
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        path = path.removingPercentEncoding ?? path
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish()
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": file.pathExtension == "js" ? "text/javascript" : mime,
                       "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// WKUserContentController keeps a strong reference to its handlers; this breaks the cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

enum Haptics {
    static func play(_ style: String) {
        switch style {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
