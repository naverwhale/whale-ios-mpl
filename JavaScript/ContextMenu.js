/* vim: set ts=2 sts=2 sw=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

window.__whale__ = window.__whale__ || {}

Object.defineProperty(window.__whale__, "ContextMenu", {
  enumerable: false,
  configurable: false,
  writable: true,
  value: {}
});


Object.defineProperty(window.__whale__.ContextMenu, "didTouch", {
  enumerable: false,
  configurable: false,
  writable: false,
  value: function(evt) {
                      
  var target = evt.target;

  var targetLink = target.closest("a");
  var targetImage = target.closest("img");
  var targetDownload = target.getAttribute("download");

  if (!targetLink && !targetImage) {
      return;
  }

  var data = {};

  if (targetLink) {
      data.link = targetLink.href;
  }

  if (targetImage) {
      data.image = targetImage.src;
  }
  
  if (targetDownload != null && targetDownload != undefined && targetDownload != "false") {
      data.hasDownload = true;
  } else {
      data.hasDownload = false;
  }
  

  if (data.link || data.image) {
      webkit.messageHandlers.touchEndEventMessageName.postMessage(data);
  }
    
  }
});

window.addEventListener("touchstart", function(evt) {
    window.__whale__.ContextMenu.didTouch(evt);
});


// Used to detect if the linkURL has been double tapped.
Object.defineProperty(window.__whale__.ContextMenu, "didClick", {
  enumerable: false,
  configurable: false,
  writable: false,
  value: function(evt) {

  var target = evt.target;
  var targetLink = target.closest("a");
  var data = {};

  if (targetLink) {
      data.link = targetLink.href;
      webkit.messageHandlers.clickEventMessageName.postMessage(data);
  }

  }
});

window.addEventListener("click", function(evt) {
    window.__whale__.ContextMenu.didClick(evt);
});


