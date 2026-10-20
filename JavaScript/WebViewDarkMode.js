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

const INSET_PROBE_CLASS = "__whale__DarkMode_insetProbe";

// 마지막 규칙: probe 의 ::backdrop 제거 — 남아 있으면 WebKit 이 probe 색 대신 backdrop(페이지 배경) 색을 샘플링
const DARK_MODE_STYLESHEET =
`html {
  -webkit-filter: hue-rotate(180deg) invert(100%) !important;
}
iframe,img,video {
  -webkit-filter: ${DARK_MODE_INVERT_FILTER_CSS} !important;
}
.${INSET_PROBE_CLASS}::backdrop {
  display: none !important;
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

// ── 상/하단 여백(obscuredContentInsets) 색 보정 ──
// WebKit 은 여백을 그 변에 걸린 fixed 요소의 CSS background-color 계산값으로 칠하는데(픽셀 샘플링 아님),
// 다크모드 필터는 픽셀만 반전하므로 fixed 헤더/하단 바가 있는 페이지에서 여백만 반전 전 색으로 남음.
// 각 변에 fixed probe 를 두고 배경을 "그 변 콘텐츠 색에 같은 필터를 적용한 색" 으로 지정해 WebKit 이 이 색을 샘플링하게 함.
//
// WebKit LocalFrameView::fixedContainerEdges 조건 (레이아웃 단위 — pageZoom 배율이 곱해짐):
// - 변 중앙 4 안쪽 지점 히트테스트 → probe 가 그 점을 덮어야 함. 폭 뷰포트 90% 이상, 높이 10 초과(앱 최소 배율 0.55 감안 32px)
// - opacity 속성 0.1 미만이나 투명 배경은 없는 요소 취급 → 화면에서 감추는 건 filter: opacity(0)
//   (페인트에만 걸리고 판정에 쓰는 opacity 속성, 배경색 계산값, 히트테스트엔 무관)
// - popover(top layer)라 사이트 z-index 와 무관하게 히트 지점 최상단 보장
// - ::backdrop 은 스타일시트에서 제거 (남으면 WebKit 이 backdrop 색을 대신 샘플링)

var INSET_PROBE_SIDES = ["top", "bottom"];
var INSET_PROBE_RESAMPLE_MS = 150;
var MIN_COLOR_ALPHA = 0.4; // 이보다 투명한 배경은 딤 오버레이로 보고 색 계산에서 제외

var insetProbes = {};
var insetProbeResampleTimer = null;

function parseRGBA(cssColor) {
  var match = (cssColor || "").match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/);
  if (!match) return null;
  var alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
  if (alpha < MIN_COLOR_ALPHA) return null;
  return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), alpha];
}

function getBackgroundRGBA(element) {
  try {
    return element ? parseRGBA(window.getComputedStyle(element).backgroundColor) : null;
  } catch (e) {
    return null;
  }
}

// 해당 변 중앙 요소부터 부모 방향으로 배경을 모아 첫 불투명 층까지 알파 합성.
// 반투명 고정 바(유리 스타일)는 뒤 배경과 섞인 색이 실제로 보이는 색. 전부 투명이면 흰색(캔버스 기본)
function getEdgeBackgroundRGB(side) {
  var element = null;
  try {
    var y = (side === "top") ? 1 : Math.max(window.innerHeight - 2, 0);
    element = document.elementFromPoint(window.innerWidth / 2, y);
  } catch (e) {}

  var chain = [];
  for (; element && element !== document.documentElement; element = element.parentElement) chain.push(element);
  if (document.body && chain.indexOf(document.body) < 0) chain.push(document.body);
  chain.push(document.documentElement);

  var layers = [];
  for (var i = 0; i < chain.length; i++) {
    var rgba = getBackgroundRGBA(chain[i]);
    if (!rgba) continue;
    layers.push(rgba);
    if (rgba[3] >= 1) break;
  }

  var rgb = [255, 255, 255];
  for (var j = layers.length - 1; j >= 0; j--) {
    var layer = layers[j];
    rgb = rgb.map(function(v, k) { return layer[k] * layer[3] + v * (1 - layer[3]); });
  }
  return rgb.map(Math.round);
}

// html 에 걸린 필터(hue-rotate(180deg) → invert(100%))를 색 값에 그대로 계산.
// hue-rotate 행렬은 CSS Filter Effects 스펙에 cos=-1, sin=0 대입한 값
function applyDarkModeFilterToRGB(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  return [
    -0.574 * r + 1.430 * g + 0.144 * b,
     0.426 * r + 0.430 * g + 0.144 * b,
     0.426 * r + 1.430 * g - 0.856 * b
  ].map(function(v) {
    return Math.round((1 - Math.min(1, Math.max(0, v))) * 255);
  });
}

Object.defineProperty(window.__whale__.DarkMode, "filterRGB", {
  value: applyDarkModeFilterToRGB,
  writable: false,
  configurable: false
});

// probe 색 — html 필터와 같은 계산을 중간값 클램프 없이 수행해 display-p3 로 지정.
// GPU 는 필터 중간값을 자르지 않아 채도 높은 색은 성분이 1.0 을 넘고 HDR 로 표시됨.
// rgb() 는 1.0 에서 잘려 여백 띠만 덜 진하므로 1.0 초과를 담는 확장 P3 값 사용 (스크린샷은 8비트라 차이 미노출)
function applyDarkModeFilterToProbeColor(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  var srgb = [
    -0.574 * r + 1.430 * g + 0.144 * b,
     0.426 * r + 0.430 * g + 0.144 * b,
     0.426 * r + 1.430 * g - 0.856 * b
  ].map(function(v) { return 1 - v; });
  // 확장 sRGB 감마 → 선형 (부호 유지)
  var linear = srgb.map(function(v) {
    var a = Math.abs(v);
    var l = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
    return v < 0 ? -l : l;
  });
  // 선형 sRGB → 선형 Display P3
  var p3Linear = [
    0.8224621 * linear[0] + 0.1775380 * linear[1],
    0.0331941 * linear[0] + 0.9668058 * linear[1],
    0.0170827 * linear[0] + 0.0723974 * linear[1] + 0.9105199 * linear[2]
  ];
  // 1.0 초과 유지 — WebKit 이 확장 P3 그대로 여백 띠 뷰에 전달
  var p3 = p3Linear.map(function(l) {
    l = Math.max(0, l);
    return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  });
  return "color(display-p3 " + p3.map(function(v) { return v.toFixed(4); }).join(" ") + ")";
}

var lastInsetProbeColors = {};

function updateInsetProbeColors() {
  INSET_PROBE_SIDES.forEach(function(side) {
    var probe = insetProbes[side];
    if (!probe) return;
    var color = applyDarkModeFilterToProbeColor(getEdgeBackgroundRGB(side));
    // 같은 값 재설정은 repaint → WebKit 재샘플만 유발. color() 는 style 값 정규화로 문자열 비교가 안 맞아 직접 보관
    if (lastInsetProbeColors[side] !== color) {
      lastInsetProbeColors[side] = color;
      probe.style.setProperty("background-color", color, "important");
    }
  });
}

function scheduleInsetProbeResample() {
  if (insetProbeResampleTimer) return;
  insetProbeResampleTimer = setTimeout(function() {
    insetProbeResampleTimer = null;
    updateInsetProbeColors();
  }, INSET_PROBE_RESAMPLE_MS);
}

function createInsetProbe(side) {
  var probe = document.createElement("div");
  probe.className = INSET_PROBE_CLASS;
  probe.setAttribute("popover", "manual");
  probe.setAttribute("aria-hidden", "true");
  // UA popover 스타일(inset:0, fit-content, border, padding)과 사이트 규칙에 밀리지 않도록 !important.
  // pointer-events:none — 터치 통과 + elementFromPoint 에서 자기 자신 제외
  var styles = {
    "position": "fixed", "inset": "auto", "left": "0", "right": "0", "width": "auto", "height": "32px",
    "margin": "0", "padding": "0", "border": "0",
    "filter": "opacity(0)", "pointer-events": "none"
  };
  styles[side] = "0";
  Object.keys(styles).forEach(function(prop) {
    probe.style.setProperty(prop, styles[prop], "important");
  });
  return probe;
}

function installInsetProbes() {
  // top layer 미지원이면 사이트 요소에 가려 히트 지점을 못 덮을 수 있어 생략
  if (typeof HTMLElement.prototype.showPopover !== "function" || !document.documentElement) return;

  INSET_PROBE_SIDES.forEach(function(side) {
    insetProbes[side] = createInsetProbe(side);
    document.documentElement.appendChild(insetProbes[side]);
  });
  updateInsetProbeColors();
  try {
    INSET_PROBE_SIDES.forEach(function(side) { insetProbes[side].showPopover(); });
  } catch (e) {
    removeInsetProbes();
    return;
  }

  // 스크롤로 변에 걸리는 요소(fixed 헤더/하단 바)가 바뀌면 재샘플
  window.addEventListener("scroll", scheduleInsetProbeResample, { passive: true });
  window.addEventListener("load", scheduleInsetProbeResample);
  window.addEventListener("resize", scheduleInsetProbeResample);
}

function removeInsetProbes() {
  window.removeEventListener("scroll", scheduleInsetProbeResample);
  window.removeEventListener("load", scheduleInsetProbeResample);
  window.removeEventListener("resize", scheduleInsetProbeResample);
  if (insetProbeResampleTimer) clearTimeout(insetProbeResampleTimer);
  insetProbeResampleTimer = null;
  lastInsetProbeColors = {};

  INSET_PROBE_SIDES.forEach(function(side) {
    var probe = insetProbes[side];
    if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
    delete insetProbes[side];
  });
}

// Create a `MutationObserver` that checks for new elements
// added that have a `background-image` in their `style`
// property/attribute.
var mutationObserver = new MutationObserver(function(mutations) {
  if (mutations.some(function(mutation) {
    return mutation.target !== insetProbes.top && mutation.target !== insetProbes.bottom;
  })) scheduleInsetProbeResample();
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
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden"]
      });

      installInsetProbes();
      window.dispatchEvent(new Event("__whaleDarkModeChanged"));
      return;
    }

    removeInsetProbes();

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
    window.dispatchEvent(new Event("__whaleDarkModeChanged"));
  }
});

window.addEventListener("DOMContentLoaded", function() {
  window.__whale__.DarkMode.setEnabled(window.__whale__.DarkMode.enabled);
  // documentStart 시점엔 body 부재로 흰색 폴백 → DOM 준비 뒤 실제 상단색으로 재샘플
  if (window.__whale__.DarkMode.enabled) scheduleInsetProbeResample();
});
