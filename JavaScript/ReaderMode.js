/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {
    "use strict";

    if (!window.webView) {
        Object.defineProperty(window, 'webView', {
            enumerable: false,
            configurable: false,
            writable: false,
            value: {}
        });
    }

    var readabilityResult = null;
    var currentStyle = null;

    var readerModeURL = /^http:\/\/localhost:\d+\/reader-mode\/page/;

    var BLOCK_IMAGES_SELECTOR = ".content p > img:only-child, " +
        ".content p > a:only-child > img:only-child, " +
        ".content .wp-caption img, " +
        ".content figure img";

    function debug(s) {
        if (!window.webView.reader.DEBUG) {
            return;
        }
        console.log(s);
    }

    // WKWebView는 requestIdleCallback를 미지원하여, 비동기 처리 코드 구현
    function scheduleIdleTask(callback) {
        setTimeout(callback, 1);    //실질적 의미는 1ms 딜레이가 아니라, 현재 작업이 끝나면 실행(다음 이벤트 루프로 미룬다). UI 블로킹을 방지.
    }

    function checkReadability() {
        if (document.location.href.match(readerModeURL)) {
            debug({Type: "ReaderModeStateChange", Value: "Active"});
            webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderModeStateChange", Value: "Active"});
            return;
        }

        if ((document.location.protocol === "http:" || document.location.protocol === "https:") && document.location.pathname !== "/") {
            // Short circuit in case we already ran Readability. This mostly happens when going
            // back/forward: the page will be cached and the result will still be there.
            if (readabilityResult && readabilityResult.content) {
                debug({Type: "ReaderModeStateChange", Value: "Available"});
                webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderModeStateChange", Value: "Available"});
                return;
            }

            var uri = {
                spec: document.location.href,
                host: document.location.host,
                prePath: document.location.protocol + "//" + document.location.host, // TODO This is incomplete, needs username/password and port
                scheme: document.location.protocol.substr(0, document.location.protocol.indexOf(":")),
                pathBase: document.location.protocol + "//" + document.location.host + location.pathname.substr(0, location.pathname.lastIndexOf("/") + 1)
            }

            // 비동기 처리: 무거운 DOM 작업을 idle 상태에서 실행하여 UI 블로킹 방지
            scheduleIdleTask(function() {
                try {
                    // DOM 요소가 너무 많으면 조기 종료하여 hang 방지
                    var MAX_DOM_ELEMENTS = 4000;
                    var elementCount = document.getElementsByTagName("*").length;
                    if (elementCount > MAX_DOM_ELEMENTS) {
                        debug("Too many DOM elements: " + elementCount + ", skipping readability");
                        webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderModeStateChange", Value: "Unavailable"});
                        return;
                    }

                    // document.cloneNode() can cause the webview to break (bug 1128774).
                    // Serialize and then parse the document instead.
                    var docStr = new XMLSerializer().serializeToString(document);
                    var doc = new DOMParser().parseFromString(docStr, "text/html");
                    var readability = new Readability(uri, doc);
                    readabilityResult = readability.parse();

                    if (readabilityResult) {
                        // Sanitize the title to prevent a malicious page from inserting HTML in the `<title>`.
                        readabilityResult.title = escapeHTML(readabilityResult.title);
                        // Sanitize the credits to prevent a malicious page from inserting HTML in the `<credits>`.
                        readabilityResult.credits = escapeHTML(readabilityResult.credits);
                    }
                    
                    debug({Type: "ReaderModeStateChange", Value: readabilityResult !== null ? "Available" : "Unavailable"});
                    webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderModeStateChange", Value: readabilityResult !== null ? "Available" : "Unavailable"});
                } catch (e) {
                    debug("Readability error: " + e.message);
                    webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderModeStateChange", Value: "Unavailable"});
                }
            });

            return;
        }

        debug({Type: "ReaderModeStateChange", Value: "Unavailable"});
        webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderModeStateChange", Value: "Unavailable"});
    }

    // Readerize the document. Since we did the actual readerization already in checkReadability, we
    // can simply return the results we already have.
    function readerize() {
        return readabilityResult;
    }

    // TODO The following code only makes sense in about:reader context. It may be a good idea to move
    //   it out of this file and into for example a Reader.js.

    function setStyle(style) {
        // Configure the theme (light, dark)
        if (currentStyle != null) {
            document.body.classList.remove(currentStyle.theme);
        }
        document.body.classList.add(style.theme);

        // Configure the font size (1-5)
        if (currentStyle != null) {
            document.body.classList.remove("font-size" + currentStyle.fontSize);
        }
        document.body.classList.add("font-size" + style.fontSize);

        // Configure the font type
        if (currentStyle != null) {
            document.body.classList.remove(currentStyle.fontType);
        }
        document.body.classList.add(style.fontType);

        // Remember the style
        currentStyle = style;
    }

    function updateImageMargins() {
        var contentElement = document.getElementById('reader-content');

        var windowWidth = window.innerWidth;
        var contentWidth = contentElement.offsetWidth;
        var maxWidthStyle = windowWidth + "px !important";

        var setImageMargins = function(img) {
            if (!img._originalWidth) {
                img._originalWidth = img.offsetWidth;
            }

            var imgWidth = img._originalWidth;

            // If the image is taking more than half of the screen, just make
            // it fill edge-to-edge.
            if (imgWidth < contentWidth && imgWidth > windowWidth * 0.55) {
                imgWidth = windowWidth;
            }

            var sideMargin = Math.max((contentWidth - windowWidth) / 2, (contentWidth - imgWidth) / 2);

            var imageStyle = sideMargin + "px !important";
            var widthStyle = imgWidth + "px !important";

            var cssText = "max-width: " + maxWidthStyle + ";" +
                "width: " + widthStyle + ";" +
                "margin-left: " + imageStyle + ";" +
                "margin-right: " + imageStyle + ";";

            img.style.cssText = cssText;
        }

        var imgs = document.querySelectorAll(BLOCK_IMAGES_SELECTOR);
        for (var i = imgs.length; --i >= 0;) {
            var img = imgs[i];
            if (img.width > 0) {
                setImageMargins(img);
            } else {
                img.onload = function() {
                    setImageMargins(img);
                }
            }
        }
    }
    
    function escapeHTML(string) {
      if (typeof(string) !== 'string') { return ''; }
      return string
        .replace(/\&/g, "&amp;")
        .replace(/\</g, "&lt;")
        .replace(/\>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/\'/g, "&#039;");
    }

    function showContent() {
        // Make the reader visible
        var headerElement = document.getElementById('reader-header');
        headerElement.style.display = "block"
        var contentElement = document.getElementById('reader-content');
        contentElement.style.display = "block";
    }

    function configureReader() {
        // Configure the reader with the initial style that was injected in the page.
        var style = JSON.parse(document.body.getAttribute("data-readerStyle"));
        setStyle(style);

        // The order here is important. Because updateImageMargins depends on contentElement.offsetWidth which
        // will not be set until contentElement is visible. If this leads to annoying content reflowing then we
        // need to look at an alternative way to do
        showContent();
        updateImageMargins();
        return style
    }

    Object.defineProperty(window.webView, 'reader', {
        enumerable: false,
        configurable: false,
        writable: true,
        value: {
          // If this is http or https content, and not an index page, then try to run Readability. If anything
          // fails, the app will never be notified and we don't show the button. That is ok for now since there
          // is no error feedback possible anyway.
          DEBUG: false
        }
    });

    Object.defineProperty(window.webView.reader, 'checkReadability', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: checkReadability
    });

    Object.defineProperty(window.webView.reader, 'readerize', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: readerize
    });
 
    Object.defineProperty(window.webView.reader, 'setStyle', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: setStyle
    });
 
    window.addEventListener('load', function(event) {
        // If this is an about:reader page that we are loading, apply the initial style to the page.
        if (document.location.href.match(readerModeURL)) {
            configureReader();
        }
    });


    window.addEventListener('pageshow', function(event) {
        // If this is an about:reader page that we are showing, fire an event to the native code
        if (document.location.href.match(readerModeURL)) {
            webkit.messageHandlers.readerModeMessageHandler.postMessage({Type: "ReaderPageEvent", Value: "PageShow"});
        }
    });
})();
