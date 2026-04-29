/* vim: set ts=2 sts=2 sw=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

window.__whale__ = window.__whale__ || {}

Object.defineProperty(window.__whale__, "DarkMode", {
  enumerable: false,
  configurable: false,
  writable: true,
  value: { enabled: false }
});


const DARK_MODE_INVERT_FILTER_CSS = "brightness(80%) invert(100%) hue-rotate(180deg)";

const DARK_MODE_STYLESHEET =
`html {
  -webkit-filter: hue-rotate(180deg) invert(100%) !important;
}
iframe,img,video {
  -webkit-filter: ${DARK_MODE_INVERT_FILTER_CSS} !important;
}`;

var styleElement;

function getStyleElement() {
  if (styleElement) {
    return styleElement;
  }

  styleElement = document.createElement("style");
  styleElement.type = "text/css";
  styleElement.appendChild(document.createTextNode(DARK_MODE_STYLESHEET));

  return styleElement;
}

function applyInvertFilterToChildBackgroundImageElements(parentNode) {
  parentNode.querySelectorAll("[style*=\"background\"]").forEach(function(el) {
    if ((el.style.backgroundImage || "").startsWith("url")) {
      applyInvertFilterToElement(el);
    }
  });
}

function applyInvertFilterToElement(el) {
  invertedBackgroundImageElements.push(el);
  el.__whale__DarkMode_originalFilter = el.style.webkitFilter;
  el.style.webkitFilter = DARK_MODE_INVERT_FILTER_CSS;
}

function removeInvertFilterFromElement(el) {
  el.style.webkitFilter = el.__whale__DarkMode_originalFilter;
  delete el.__whale__DarkMode_originalFilter;
}

var invertedBackgroundImageElements = null;

// Create a `MutationObserver` that checks for new elements
// added that have a `background-image` in their `style`
// property/attribute.
var mutationObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        applyInvertFilterToChildBackgroundImageElements(node);
      }
    });
  });
});

Object.defineProperty(window.__whale__.DarkMode, "setEnabled", {
  enumerable: false,
  configurable: false,
  writable: false,
  value: function(enabled) {
    if (enabled === window.__whale__.DarkMode.enabled) {
      return;
    }

    window.__whale__.DarkMode.enabled = enabled;

    var styleElement = getStyleElement();

    if (enabled) {
      invertedBackgroundImageElements = [];

      // Apply the DarkMode CSS to the document.
      document.documentElement.appendChild(styleElement);

      // Add the "invert" CSS class name to all elements with a
      // `background-image` in their `style` property/attribute.
      applyInvertFilterToChildBackgroundImageElements(document);

      // Observe for future elements in the document containing
      // `background-image` in their `style` property/attribute
      // so that we can also apply the "invert" CSS class name
      // to them as they are added.
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      return;
    }

    // Stop observing for future elements in the document.
    mutationObserver.disconnect();

    // Remove the "invert" CSS class name from all elements
    // it was previously applied to.
    invertedBackgroundImageElements.forEach(removeInvertFilterFromElement);

    // Remove the DarkMode CSS from the document.
    var styleElementParentNode = styleElement.parentNode;
    if (styleElementParentNode) {
      styleElementParentNode.removeChild(styleElement);
    }

    invertedBackgroundImageElements = null;

    // Workaround for Bug 1424243 where turning Dark Mode *off*
    // in some cases has no effect on the background color for
    // web pages that do not specify a background color.
    var computedBackgroundColor = window.getComputedStyle(document.documentElement).getPropertyValue('background-color');
    if (computedBackgroundColor === "rgba(0, 0, 0, 0)") {
      document.documentElement.style.backgroundColor = "#fff";
    }
  }
});

window.addEventListener("DOMContentLoaded", function() {
  window.__whale__.DarkMode.setEnabled(window.__whale__.DarkMode.enabled);
});
