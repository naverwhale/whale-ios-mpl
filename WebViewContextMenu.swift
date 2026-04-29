/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Originally derived from brave/brave-core (long-press hijack pattern,
//   accompanies ContextMenu.js loaded at runtime).
// Modified by NAVER Corp. for Whale iOS.

import Foundation
import UIKit
import WebKit
import WhaleCommon


protocol WebViewContextMenuDelegate: AnyObject {
    
    func webViewContextMenu(_ webViewContextMenu: WebViewContextMenu, didLongPressElements elements: ContextMenuElements)
    func webViewContextMenu(_ webViewContextMenu: WebViewContextMenu, didCancelGestureRecognizer: UIGestureRecognizer)
    
}

struct ContextMenuElements {
    
    let link: URL?
    let image: URL?
    
}

class WebViewContextMenu: NSObject, JavaScriptHelper  {
    
    
    init(webView: WKWebView, isQuickSearchMode: Bool) {
        self.isQuickSearchMode = isQuickSearchMode
        super.init()
        
        self.webView = webView
    }
    
    weak var delegate: WebViewContextMenuDelegate?
    var scripts: [String] {
        return [Bundle.main.loadJavaScript(with: "ContextMenu")]
    }
    
    var htmlTagDownloadURL: URL?
    
    func injectUserScript(_ userContentController: WKUserContentController) {
        guard self.canInjectUserScript(in: userContentController) == true else { return }
        
        for script in self.scripts {
            let userScript = WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
            userContentController.addUserScript(userScript)
        }
        
        userContentController.add(self, name: self.touchEndEventMessageName)
        userContentController.add(self, name: self.clickEventMessageName)
    }
    
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let data = message.body as? [String: AnyObject] else {
            return
        }

        let linkURL: URL? = self.encodedURL(data["link"] as? String)
        
        switch message.name {
        case self.touchEndEventMessageName:
            if let hasDownload = data["hasDownload"] as? Bool, hasDownload {
                self.htmlTagDownloadURL = linkURL
            } else {
                self.htmlTagDownloadURL = nil
            }
            
            let imageURL: URL? = self.encodedURL(data["image"] as? String)
            let newElements = ContextMenuElements(link: linkURL, image: imageURL)
            self.updateLongPress(elements: (linkURL == nil && imageURL == nil) ? nil : newElements)
            
        case self.clickEventMessageName:
            guard DoubleTapActionType(rawValue: ConfigurationManager.shared.doubleTapConfig)?.isUsing == true,
                  self.isQuickSearchMode == false,
                  linkURL?.isValid == true else {
                return
            }
            
            self.tappedURL = linkURL
            
        default:
            ()
        }
    }

    func resetTappedURL() {
        self.tappedURL = nil
    }
    
    
    private weak var webView: WKWebView?
    
    private let touchEndEventMessageName = "touchEndEventMessageName"
    private let clickEventMessageName = "clickEventMessageName"
    
    
    //  MARK: - LongPress ContextMenu
    private var nativeHighlightLongPressRecognizer: UILongPressGestureRecognizer?
    private(set) var longPressElements: ContextMenuElements?
    
    //  MARK: - Double-tap QuickSearch
    private(set) var tappedURL: URL?
    private var isQuickSearchMode: Bool
    
    
    private func encodedURL(_ urlString: String?) -> URL? {
        guard let urlString = urlString,
              let encodedURLString = urlString.addingPercentEncoding(withAllowedCharacters: .URLAllowed) else { return nil }
        return URL(string: encodedURLString)
    }
}


extension WebViewContextMenu: UIGestureRecognizerDelegate {
    
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return true
    }

}


extension WebViewContextMenu {
    

    @objc func longPressGestureDetected(_ sender: UIGestureRecognizer) {
        if sender.state == .cancelled {
            self.delegate?.webViewContextMenu(self, didCancelGestureRecognizer: sender)
            return
        }
        
        guard sender.state == .began else {
            return
        }
        
        // To prevent the tapped link from proceeding with navigation, "cancel" the native WKWebView
        // `_highlightLongPressRecognizer`. This preserves the original behavior as seen here:
        // https://github.com/WebKit/webkit/blob/d591647baf54b4b300ca5501c21a68455429e182/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L1600-L1614
        if let nativeHighlightLongPressRecognizer = self.nativeHighlightLongPressRecognizer,
            nativeHighlightLongPressRecognizer.isEnabled {
            nativeHighlightLongPressRecognizer.isEnabled = false
            nativeHighlightLongPressRecognizer.isEnabled = true
        }

        if let longPressElements = self.longPressElements {
            self.delegate?.webViewContextMenu(self, didLongPressElements: longPressElements)
            self.longPressElements = nil
        }
    }
    
    // BVC KVO events for all changes on the webview will call this.
    // It is called frequently during a page load (particularly on progress changes and URL changes).
    // As of iOS 12, WKContentView gesture setup is async, but it has been called by the time
    // the webview is ready to load an URL. After this has happened, we can override the gesture.
    func replaceGestureHandlerIfNeeded() {
        DispatchQueue.main.async {
            self.replaceWebViewLongPress()
        }
    }
    
    private func replaceWebViewLongPress() {
        if self.nativeHighlightLongPressRecognizer == nil {
            self.nativeHighlightLongPressRecognizer = gestureRecognizerWithDescriptionFragment("action=_highlightLongPressRecognized:")
        }
        
        if let nativeLongPressRecognizer = gestureRecognizerWithDescriptionFragment("action=_longPressRecognized:") {
            nativeLongPressRecognizer.removeTarget(nil, action: nil)
            nativeLongPressRecognizer.addTarget(self, action: #selector(self.longPressGestureDetected))
        }
    }
    
    private func gestureRecognizerWithDescriptionFragment(_ descriptionFragment: String) -> UILongPressGestureRecognizer? {
        let result = self.webView?.scrollView.subviews.compactMap({ $0.gestureRecognizers }).joined().first(where: {
            (($0 as? UILongPressGestureRecognizer) != nil) && $0.description.contains(descriptionFragment)
        })
        return result as? UILongPressGestureRecognizer
    }
    
    private func updateLongPress(elements: ContextMenuElements?) {
        self.longPressElements = elements
    }

}
