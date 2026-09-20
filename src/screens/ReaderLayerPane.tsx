/**
 * 阅读器的一个「层」面板：原文 / 义注 / 复注三选一，见 `ReaderScreen.tsx`。
 *
 * 每个面板管理自己的阅读单元、频道、目录、上一章/下一章、正文加载与阅读
 * 记录 —— 结构上几乎就是过去单层 `ReaderScreen` 的正文部分，只是把
 * `route.params` 换成了 props（对应哪一层由外层 PagerView 决定，见
 * `docs/reading-content.md`、`docs/commentary-layers.md`）。
 *
 * 字号 / 主题（`settings`）是全局偏好，由外层统一加载、下发，三个面板共享；
 * 章节位置、频道、目录展开状态等其余状态都是面板自己的。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getBookChannels } from "../api";
import {
  WINDOW_STRLEN,
  bookBounds,
  extendWindow,
  getBookHeadingRows,
  getChapterUnitAt,
  getNextUnit,
  getPrevUnit,
  getReadingUnitAt,
  initialWindow,
  loadParasMap,
  localChannelsFor,
  paragraphLengths,
  rememberChannelName,
  resolveStartParagraph,
  tipitakaRunner,
  type HeadingRow,
  type ParaWindow,
  type ReadingUnit,
} from "../reading";
import type { ChapterChannel } from "../catalog";
import { getBookHeadings } from "../catalog/headings";
import { saveReadingRecord } from "../data/history";
import { ChapterDrawer, ChapterTree } from "../components/ChapterDrawer";
import { DownloadIconButton } from "../components/DownloadIconButton";
import { serifFont } from "../theme";
import { useLayout } from "../hooks/useLayout";
import {
  LIST_PANE_WIDTH,
  MAX_CONTENT_WIDTH,
  SIDENOTE_MARGIN_MIN_WIDTH,
  SIDENOTE_WIDTH,
  widthClassOf,
} from "../theme/breakpoints";
import { readerColors, type ReaderChrome } from "../theme/reader";
import { useI18n, useT } from "../i18n/I18nContext";
import {
  convertPaliHtml,
  convertScript,
  resolvePaliScript,
  scriptToRoman,
} from "../pali/script";
import { fontSizePx, type ReaderSettings } from "../settings/reader";
import type { RootStackParamList } from "../navigation/types";
import { ensureAiAvailable } from "../ai/availability";

type ReaderNavigation = NativeStackNavigationProp<RootStackParamList, "Reader">;

/** 兜底版本：巴利原文，各书基本都有，自动选版本找不到偏好版本时降级到它。 */
const FALLBACK_CHANNEL_NAME = "_System_Pali_VRI_";

interface ReaderDoc {
  title: string;
  subtitle?: string;
  body: string;
}

/**
 * 覆盖某个段落的最深层章节标题（品 → 经 → 子标题），用于滚动时让顶部标题跟随
 * 当前位置，而不是停留在「阅读单元」那一级的标题（如整个品名）。
 */
function headingTocFor(book: number, para: number): string | null {
  const headings = getBookHeadings(book);
  let toc: string | null = null;
  for (const h of headings) {
    if (h.paragraph <= para) toc = h.toc;
  }
  return toc;
}

/** HTML 转义（目录标题当作文本塞进 HTML 前用）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 空标题段回退渲染：频道没返回标题行正文时，用目录库的 toc 补一个标题。
 *
 * 服务端会跳过 `display` 为空的段落（含章节标题行），译文频道尤其常见——
 * 于是正文里看不到章节分界。这里对「level ≤ 7 且无正文」的段，用目录里的
 * toc 渲染一个 `<h4>` 标题（class='original' 让巴利字体转换照常作用于标题）。
 */
function renderParaHtml(
  para: number,
  html: string | undefined,
  headings: Map<number, HeadingRow> | undefined,
): string {
  if (html) return html;
  const h = headings?.get(para);
  if (h && h.toc) {
    return `<div class='original' data-para='${para}'><h4>${escapeHtml(h.toc)}</h4></div>`;
  }
  return "";
}

export interface ReaderLayerPaneProps {
  book: number;
  /** 初始定位段。原文层缺省时按阅读记录/本书首章续读；义注/复注层由对应算法给出，一定有值。 */
  paragraph?: number;
  /** 书名（阅读记录 / 版本弹层标题用）。 */
  title: string;
  /** 进场前已知的章节标题，用于 unit 解出来之前的过渡显示。 */
  initialToc?: string | null;
  initialChannelId?: string;
  initialChannelName?: string;
  /** 自动选版本时优先匹配的版本名（如「deepseek」）——同名版本存在就用它，而不是无脑取第一个。 */
  /** 上一层用的版本 uid —— 认版本认它，显示名可能被改。 */
  preferredChannelUid?: string;
  preferredChannelName?: string;
  settings: ReaderSettings;
  /** 每次这一层的阅读单元变化都会调用（含首次进入），供外层算/重算义注复注章节。 */
  onChapterAnchor: (
    book: number,
    paragraph: number,
    toc: string | null,
  ) => void;
  /** 版本变化（自动选定或手动切换）都会调用，供外层记住「当前偏好的版本名」，义注/复注第一次加载时接着用。 */
  onChannelChange?: (
    channelUid: string | undefined,
    channelName: string | undefined,
  ) => void;
  /** 用户点击 <cite> 跳转锚点：外层切到义注/复注对应层并定位到该句。 */
  onAnnoJump: (book: number, para: number, start: number, end: number) => void;
  /** 用户点击角标（平板双栏）：定位到另一栏对应句并高亮，但不切换层。 */
  onCrossHighlight: (book: number, para: number, start: number, end: number) => void;
  /** 需要滚动到并高亮的句子 data-sid（如 "101-507-2-23"）；仅命中的那一层有值。 */
  highlightSid?: string | null;
  navigation: ReaderNavigation;
}

function buildReaderHtml(
  doc: ReaderDoc,
  opts: {
    fontSizePx: number;
    dark: boolean;
    contentWidth: number;
    measure: number;
    sidenote: "inline" | "margin";
    annoClamp: number;
    annotationMode: "inline" | "footnote";
  },
): string {
  const vars = opts.dark
    ? "--paper:#211d17;--ink:#e8dfd0;--ink-soft:#bfb198;--ink-faint:#8f8166;--vermilion:#d17a67;--hairline:#3a3227;"
    : "--paper:#f7f3ea;--ink:#3a3128;--ink-soft:#6b5f4e;--ink-faint:#9a8c76;--vermilion:#8c3b2e;--hairline:#d8cdb4;";
  return `<!DOCTYPE html>
<html lang="zh" data-sidenote="${opts.sidenote}" data-annotation-mode="${opts.annotationMode}" data-content-width="${opts.contentWidth}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    ${vars}
    --base:${opts.fontSizePx}px;
    --measure:${opts.measure}px;
    --sidenote-w:${SIDENOTE_WIDTH}px;
    --anno-clamp:${opts.annoClamp};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--paper);
    color: var(--ink);
    overflow-wrap: break-word;
    /*
     * 巴利可以转成缅甸文 / 泰文 / 锡兰文 / 天城体显示（见 src/pali/script），
     * 这些字符 Georgia 里没有，字体栈要把系统的 Noto 各字重带上，
     * 否则落到豆腐块。
     */
    font-family: Georgia, "Songti SC", "Noto Serif SC",
      "Noto Sans Myanmar", "Noto Serif Myanmar", "Padauk",
      "Noto Sans Sinhala", "Noto Serif Sinhala",
      "Noto Sans Thai", "Noto Serif Thai",
      "Noto Sans Tai Tham", "Noto Sans Telugu", serif;
    font-size: var(--base);
    line-height: 1.95;
    -webkit-text-size-adjust: 100%;
  }
  .paper {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 20px 18px 60px;
  }
  [data-sidenote="margin"] .paper {
    margin-right: calc(var(--sidenote-w) + 24px);
  }
  /* 巴利长词（Rājāmaccakathāvaṇṇanā 之类）没有断词点，不允许断行就会被裁掉。 */
  .doc-title {
    font-size: 1.45em;
    font-weight: 700;
    margin: 8px 0 4px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .doc-subtitle { color: var(--ink-soft); font-size: 0.82em; margin-bottom: 24px; }

  .original, .translation { margin: 0 0 0.55em; }
  .original::after, .translation::after { content: ""; display: block; clear: both; }
  /*
   * 段号用绝对定位挂在左槽里，不能用 float —— 段落正文若以有序列表
   * （「150.」这类）开头，浮动的段号会和列表序号叠在一起。
   */
  /* 只匹配段落外壳 div[data-para]：角标 <label> / <cite> 也带 data-para（跳转目标段号），
     不能一起命中，否则它们的 ::before 会把 507 之类的段号当角标前缀显示出来。 */
  div[data-para] {
    position: relative;
    padding-left: 2.3em;
  }
  div[data-para]::before {
    content: attr(data-para);
    position: absolute;
    left: 0;
    top: 0.22em;
    /* 宽度按 ::before 自己的 0.6em 计，要给到 3.2em 才够放四位数并保持不折行 */
    width: 3.2em;
    white-space: nowrap;
    text-align: right;
    color: var(--ink-faint);
    font-size: 0.6em;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  /* 列表自己的序号也要留在左槽之内，别再往外顶。 */
  div[data-para] ol, div[data-para] ul { margin: 0; padding-left: 1.4em; }
  .sentence { display: inline; }
  .sentence + .sentence::before { content: " "; }
  strong { font-weight: 700; }

  code {
    font-family: inherit;
    color: var(--vermilion);
    font-size: 0.68em;
    vertical-align: super;
    margin: 0 1px;
    cursor: pointer;
  }

  input.margin-toggle { display: none; }
  .sidenote-number {
    display: inline-block;
    color: var(--vermilion);
    cursor: pointer;
    vertical-align: super;
    font-size: 0.72em;
    margin-left: 2px;
  }
  .sidenote {
    display: none;            /* 行内模式默认收起，点角标再展开 */
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--ink-soft);
    border-left: 2px solid var(--hairline);
    padding-left: 10px;
    margin: 4px 0 18px;
  }
  .margin-toggle:checked + .sidenote {
    display: block;
  }
  [data-sidenote="margin"] .sidenote {
    display: block;           /* 边注模式常驻右侧栏 */
    float: right;
    clear: right;
    width: var(--sidenote-w);
    margin-right: calc(-1 * (var(--sidenote-w) + 24px));
    margin-top: 4px;
    border-left: none;
    border-top: 2px solid var(--hairline);
    padding: 4px 0 0;
  }
  .anno-jump {
    cursor: pointer;
    color: var(--vermilion);
    font-style: normal;
    margin-left: 0.4em;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  .anno-highlight {
    background: rgba(140, 59, 46, 0.16);
    border-radius: 3px;
    transition: background 0.5s;
  }
  .anno-footnotes {
    margin: 12px 0 0;
  }
  .anno-footnote {
    margin: 6px 0;
    font-size: 0.85em;               /* 比正文小一点，跟着 --base 字号设置走 */
    line-height: 1.6;
    color: var(--ink-soft);
    border: 1px solid var(--hairline); /* 灰色边框 */
    border-radius: 4px;
    padding: 6px 8px;
  }
  .anno-fn-toggle { display: none; }
  .anno-fn-label {
    display: flex;
    align-items: flex-start;
  }
  .anno-fn-num {
    color: var(--vermilion);
    flex: none;
    margin-right: 0.45em;
    cursor: pointer;
  }
  .anno-fn-body {
    flex: 1;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: var(--anno-clamp, 1);
    -webkit-box-orient: vertical;
    overflow: hidden;
    cursor: pointer;
  }
  .anno-fn-toggle:checked + .anno-fn-label .anno-fn-body {
    -webkit-line-clamp: unset;
    display: block;
    overflow: visible;
  }
  /* 段后脚注的 <cite> 跳转链接：收起时隐藏，展开才显示 */
  .anno-footnote .anno-jump {
    display: none;
    margin-left: 0.4em;
  }
  .anno-fn-toggle:checked ~ .anno-jump {
    display: inline;
  }
  /* 手机注释模式：行内 = 只留角标边注；段后 = 显示正文角标 + 段后脚注列表 */
  [data-annotation-mode="inline"] .anno-footnotes { display: none; }
  [data-annotation-mode="footnote"] .sidenote { display: none !important; }

  /* 懒加载方向指示：固定在视口上/下沿，不参与文档流（不影响 scrollHeight）。 */
  .wl-loading {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--paper);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.14);
    color: var(--ink-soft);
    font-size: 0.75em;
  }
  .wl-loading[data-dir="up"] { top: 12px; }
  .wl-loading[data-dir="down"] { bottom: 12px; }
  .wl-loading::before {
    content: "";
    width: 14px;
    height: 14px;
    border: 2px solid var(--hairline);
    border-top-color: var(--vermilion);
    border-radius: 50%;
    animation: wl-spin 0.8s linear infinite;
  }
  @keyframes wl-spin { to { transform: rotate(360deg); } }
</style>
<script>
  // 高亮辅助：给目标短暂加上 .anno-highlight（2.2s 后移除，与 RN 侧一致）。
  function flashAnno(el) {
    if (!el) return;
    el.classList.add("anno-highlight");
    setTimeout(function () { el.classList.remove("anno-highlight"); }, 2200);
  }
  // 在同一段（段落外壳 div[data-para]）内按 data-idx 找目标，避免跨段误命中同名编号。
  function annoTargetInPara(origin, selector, idx) {
    var para = origin && origin.closest ? origin.closest("div[data-para]") : null;
    if (!para) return null;
    return para.querySelector(selector + '[data-idx="' + idx + '"]');
  }
  // <cite class="anno-jump"> 点击 → 通知 RN 跳到义注/复注对应句
  // <label class="sidenote-number"> 点击 → 通知 RN 跨栏高亮对应句（同时仍会展开本行边注）
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".anno-jump") : null;
    if (t) {
      e.preventDefault();
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "anno-jump",
          book: t.getAttribute("data-book"),
          para: t.getAttribute("data-para"),
          start: t.getAttribute("data-start"),
          end: t.getAttribute("data-end")
        }));
      }
      return;
    }

    // 点脚注编号 [N] → 滚回正文角标并高亮（preventDefault 避免触发脚注展开/收起）
    var fnNum = e.target && e.target.closest ? e.target.closest(".anno-fn-num") : null;
    if (fnNum) {
      e.preventDefault();
      var fi = fnNum.getAttribute("data-idx");
      var mark = annoTargetInPara(fnNum, ".sidenote-number", fi);
      if (mark) {
        mark.scrollIntoView({ block: "center", behavior: "smooth" });
        flashAnno(mark);
      }
      return;
    }

    // 点正文角标 → 段后脚注模式下滚到对应脚注并高亮（行内模式仍展开边注）
    var n = e.target && e.target.closest ? e.target.closest(".sidenote-number") : null;
    if (n) {
      var mi = n.getAttribute("data-idx");
      if (mi && document.documentElement.getAttribute("data-annotation-mode") === "footnote") {
        var fn = annoTargetInPara(n, ".anno-footnote", mi);
        if (fn) {
          e.preventDefault();
          fn.scrollIntoView({ block: "center", behavior: "smooth" });
          flashAnno(fn);
        }
      }
      if (n.getAttribute("data-book") &&
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "cross-highlight",
          book: n.getAttribute("data-book"),
          para: n.getAttribute("data-para"),
          start: n.getAttribute("data-start"),
          end: n.getAttribute("data-end")
        }));
      }
    }
  });
</script>
</head>
<body>
  <div class="paper">
    <div class="doc-title">${doc.title}</div>
    ${doc.subtitle ? `<div class="doc-subtitle">${doc.subtitle}</div>` : ""}
    ${doc.body}
  </div>
  <script>
    // ---- 段号 / 脚注编号 ----
    // 角标和段后脚注的编号：按「段」分组、按文档顺序编号，两者一一对应。
    // 用 JS 显式编号，不依赖 CSS counter —— 部分 WebView 里 counter-reset 在
    // 嵌套结构下不按预期作用域重置，会出现正文角标全是 [1] 的情况。
    // 抽成全局函数：懒加载向上/向下追加的新段也要过一遍同样的编号。
    function numberPara(para) {
      var markers = para.querySelectorAll(".sidenote-number");
      for (var i = 0; i < markers.length; i++) {
        markers[i].textContent = "[" + (i + 1) + "]";
        markers[i].setAttribute("data-idx", i + 1);
      }
      var fns = para.querySelectorAll(".anno-footnote");
      for (var j = 0; j < fns.length; j++) {
        fns[j].setAttribute("data-idx", j + 1);
        var label = fns[j].querySelector(".anno-fn-label");
        if (label && !label.querySelector(".anno-fn-num")) {
          var num = document.createElement("span");
          num.className = "anno-fn-num";
          num.textContent = "[" + (j + 1) + "]";
          num.setAttribute("data-idx", j + 1);
          label.insertBefore(num, label.firstChild);
        }
      }
    }
    window.__wlNumberParas = function (root) {
      var paras = root.querySelectorAll("div[data-para]");
      for (var p = 0; p < paras.length; p++) numberPara(paras[p]);
    };

    // ---- 窗口化懒加载（配合 RN 的 handleWlNeed / handleWlAnchor） ----
    (function () {
      var paper = document.querySelector(".paper");
      var scroller = document.scrollingElement || document.documentElement;

      function post(msg) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(msg));
        }
      }

      // 距边缘 1.5 屏就请求加载；移出屏幕超过 3 屏才卸载（留足缓冲，避免抖动）。
      var NEED_EDGE_SCREENS = 1.5;
      var UNLOAD_MARGIN_SCREENS = 3;

      var needDown = false;
      var needUp = false;

      function checkEdges() {
        var st = scroller.scrollTop;
        var vh = window.innerHeight;
        var sh = scroller.scrollHeight;
        var ps = paper.querySelectorAll("div[data-para]");
        var domFirst = ps.length ? Number(ps[0].getAttribute("data-para")) : 0;
        var domLast = ps.length ? Number(ps[ps.length - 1].getAttribute("data-para")) : 0;
        var nearBottom = sh - (st + vh) < vh * NEED_EDGE_SCREENS;
        if (nearBottom && !needDown) {
          needDown = true;
          post({ type: "wl-need", dir: "down", domFirst: domFirst, domLast: domLast });
        }
        if (!nearBottom) needDown = false;
        var nearTop = st < vh * NEED_EDGE_SCREENS;
        if (nearTop && !needUp) {
          needUp = true;
          post({ type: "wl-need", dir: "up", domFirst: domFirst, domLast: domLast });
        }
        if (!nearTop) needUp = false;
      }

      // 按滚动方向只卸载「正在离开」的那一侧：
      // 向下滚 → 只卸顶部（底部马上要滚到，不能删，否则留下 56 直接接 66 的洞）；
      // 向上滚 → 只卸底部。这样 DOM 始终是连续区间，need down/up 才能正确回填。
      function unloadFar(scrollDir) {
        var ps = paper.querySelectorAll("div[data-para]");
        if (ps.length <= 1) return;
        var vh = window.innerHeight;
        var margin = vh * UNLOAD_MARGIN_SCREENS;

        if (scrollDir === "down") {
          var beforeScroll = scroller.scrollTop;
          var beforeH = scroller.scrollHeight;
          var topRemove = [];
          for (var i = 0; i < ps.length; i++) {
            var r = ps[i].getBoundingClientRect();
            if (r.bottom < -margin) topRemove.push(ps[i]);
            else break;
          }
          if (topRemove.length >= ps.length) topRemove.length = 0; // 至少留一段
          for (var t = 0; t < topRemove.length; t++) topRemove[t].remove();
          if (topRemove.length > 0) {
            post({
              type: "wl-unload",
              dir: "up",
              from: Number(topRemove[0].getAttribute("data-para")),
              to: Number(topRemove[topRemove.length - 1].getAttribute("data-para")),
              count: topRemove.length,
              domCount: ps.length,
              domFirst: Number(ps[0].getAttribute("data-para")),
              scrollTop: Math.round(scroller.scrollTop)
            });
          }
          // 顶部卸载后补偿滚动，保持视口内容不动
          var removedTopH = beforeH - scroller.scrollHeight;
          if (removedTopH > 0) scroller.scrollTop = beforeScroll - removedTopH;
        } else {
          var bottomRemove = [];
          for (var b = ps.length - 1; b >= 0; b--) {
            var rb = ps[b].getBoundingClientRect();
            if (rb.top > vh + margin) bottomRemove.push(ps[b]);
            else break;
          }
          if (bottomRemove.length >= ps.length) bottomRemove.length = 0;
          for (var u = 0; u < bottomRemove.length; u++) bottomRemove[u].remove();
          if (bottomRemove.length > 0) {
            var bFrom = Infinity, bTo = -Infinity;
            for (var u2 = 0; u2 < bottomRemove.length; u2++) {
              var bp = Number(bottomRemove[u2].getAttribute("data-para"));
              if (bp < bFrom) bFrom = bp;
              if (bp > bTo) bTo = bp;
            }
            post({ type: "wl-unload", dir: "down", from: bFrom, to: bTo, count: bottomRemove.length });
          }
        }
      }

      var lastAnchor = -1;
      // 滚动方向：由「视口顶部段号」的增减判断，但加累积滞回——段号连续移动
      // ≥2 段才换向。顶部卸载的滚动补偿有 ±1px 抖动，会让顶部段号在相邻两段间
      // 跳一下（40↔41），若不滞回就会被误判成反向，从而误卸载另一侧、挖出洞。
      var scrollDir = "down";
      var dirAccum = 0;
      function reportAnchor() {
        var ps = paper.querySelectorAll("div[data-para]");
        for (var i = 0; i < ps.length; i++) {
          var r = ps[i].getBoundingClientRect();
          if (r.bottom > 0) {
            var p = Number(ps[i].getAttribute("data-para"));
            if (p !== lastAnchor && isFinite(p)) {
              if (lastAnchor > 0) {
                dirAccum += p - lastAnchor;
                if (dirAccum >= 2) { scrollDir = "down"; dirAccum = 0; }
                else if (dirAccum <= -2) { scrollDir = "up"; dirAccum = 0; }
              }
              lastAnchor = p;
              post({ type: "wl-anchor", para: p });
            }
            break;
          }
        }
      }

      // 加载方向指示：固定在视口上/下沿的转圈，防止滑到底发现没内容。
      function loadingEl(dir) {
        return paper.querySelector('.wl-loading[data-dir="' + dir + '"]');
      }
      window.__wlShowLoading = function (dir) {
        if (loadingEl(dir)) return;
        var el = document.createElement("div");
        el.className = "wl-loading";
        el.setAttribute("data-dir", dir);
        // position: fixed 不参与文档流，插哪都行；放 paper 里随页面一起被替换。
        paper.appendChild(el);
      };
      window.__wlHideLoading = function (dir) {
        var el = loadingEl(dir);
        if (el) el.remove();
      };

      // 向下追加段落（RN 已按巴利字体转换、已剔除空段）
      window.__wlAppend = function (html) {
        window.__wlHideLoading("down");
        paper.insertAdjacentHTML("beforeend", html);
        window.__wlNumberParas(paper);
        needDown = false; // 追加后重新评估：若仍贴底则继续请求下一批
        checkEdges();
      };

      // 向上追加段落并补偿滚动，让视口不跳
      window.__wlPrepend = function (html) {
        window.__wlHideLoading("up");
        var beforeH = scroller.scrollHeight;
        var beforeScroll = scroller.scrollTop;
        var marker = paper.querySelector("div[data-para]");
        var tpl = document.createElement("template");
        tpl.innerHTML = html;
        paper.insertBefore(tpl.content, marker);
        window.__wlNumberParas(paper);
        var addedH = scroller.scrollHeight - beforeH;
        if (addedH > 0) scroller.scrollTop = beforeScroll + addedH;
        needUp = false; // 同 down：补齐后仍贴顶则继续请求上一批
        checkEdges();
      };

      var rafPending = false;
      function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () {
          rafPending = false;
          checkEdges();
          reportAnchor();       // 先据顶部段号更新滚动方向
          unloadFar(scrollDir); // 再按方向只卸载离开的那一侧
        });
      }

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });

      // 首屏：编号 → 上报锚点 → 检查边缘（首屏不足 1.5 屏时立即补加载）
      window.__wlNumberParas(paper);
      reportAnchor();
      checkEdges();
    })();
  </script>
</body>
</html>`;
}

function NavBtn({
  icon,
  label,
  iconPosition = "left",
  disabled,
  c,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** 不传就只显示图标（比如「目录」）。 */
  label?: string;
  /** 图标相对文字的位置，「下一章」箭头习惯放文字右边。 */
  iconPosition?: "left" | "right";
  disabled?: boolean;
  c: ReaderChrome;
  onPress: () => void;
}) {
  const color = disabled ? c.inkFaint : c.ink;
  const iconEl = <Ionicons name={icon} size={18} color={color} />;
  const labelEl = label ? (
    <Text style={[styles.navBtnLabel, { color }]} numberOfLines={1}>
      {label}
    </Text>
  ) : null;
  return (
    <Pressable
      style={styles.navBtn}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
    >
      {iconPosition === "right" ? (
        <>
          {labelEl}
          {iconEl}
        </>
      ) : (
        <>
          {iconEl}
          {labelEl}
        </>
      )}
    </Pressable>
  );
}

export function ReaderLayerPane({
  book,
  paragraph,
  title,
  initialToc,
  initialChannelId,
  initialChannelName,
  preferredChannelUid,
  preferredChannelName,
  settings,
  onChapterAnchor,
  onChannelChange,
  onAnnoJump,
  onCrossHighlight,
  highlightSid,
  navigation,
}: ReaderLayerPaneProps) {
  const t = useT();

  const [unit, setUnit] = useState<ReadingUnit | null>(null);
  const [channelId, setChannelId] = useState<string | undefined>(
    initialChannelId,
  );
  const [channelName, setChannelName] = useState<string | undefined>(
    initialChannelName,
  );
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  /** 当前滚动位置所在的最深层章节标题（随滚动更新，供顶部标题跟随）。 */
  const [headingToc, setHeadingToc] = useState<string | null>(null);
  const headingTocRef = useRef<string | null>(null);
  /** 锚点防抖定时器：滚动补偿的 ±1px 抖动会让顶部段在章节边界来回跳，稍等再提交。 */
  const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const { listDetail } = useLayout();
  const [paneOpen, setPaneOpen] = useState(false);
  const [panePinned, setPanePinned] = useState(false);
  const [versionVisible, setVersionVisible] = useState(false);
  const [channels, setChannels] = useState<ChapterChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  // ---- 窗口化懒加载状态 ----
  // 正文不再「一次加载整个阅读单元」，而是维护一个按巴利文字符数滑动的段落
  // 窗口 [win.from, win.to]，滚动到边缘再扩、移出屏幕过远就卸载（见 window.ts）。
  const [jumpNonce, setJumpNonce] = useState(0);
  /** 下一次（重）载入窗口时以哪一段为锚点（初始进入 / 目录跳转 / 上一下一章）。 */
  const jumpTargetRef = useRef<number | null>(null);
  /** 当前已加载进 DOM 的段落窗口。 */
  const winRef = useRef<ParaWindow | null>(null);
  /** 本书段落范围（lo..hi）。 */
  const boundsRef = useRef<{ lo: number; hi: number } | null>(null);
  /** 本书段落号 → 巴利文字符数。 */
  const lengthsRef = useRef<Map<number, number>>(new Map());
  /** 本书标题行（level ≤ 7）：段落号 → {level, toc}，用于空标题段回退渲染。 */
  const headingsRef = useRef<Map<number, HeadingRow> | undefined>(undefined);
  /** 视口顶部当前所在的段（WebView 上报，滚动中持续更新）。 */
  const topParaRef = useRef<number>(0);
  /** 各方向是否有在途的增量取数 —— 防止快速滚动连发 wl-need 重复请求同一区间。 */
  const loadingRef = useRef<{ up: boolean; down: boolean }>({
    up: false,
    down: false,
  });
  /** 内容（重）载入的代际号：跳转/换版后丢弃在途的增量注入。 */
  const loadTokenRef = useRef(0);
  /** 与 `unit` 状态同步的一份 ref，供回调里读最新值。 */
  const unitRef = useRef<ReadingUnit | null>(null);
  /** 本层最后上报给外层的锚点（book+paragraph），用于识别「外层回显」跳过重载。 */
  const reportedAnchorRef = useRef<{ book: number; paragraph: number } | null>(
    null,
  );

  const c = readerColors(settings.theme === "dark");
  const isDark = settings.theme === "dark";

  // 进入 / 换章：定位阅读单元。paragraph 有值（义注/复注层恒有值，原文层
  // 是目录点击或深链接）就直接用；原文层未指定则续读上次位置或本书第一章。
  //
  // 连续滚动后，外层会把本层刚上报的锚点回写进 `paragraph`（自回显）——
  // 那只是标题/伴读层坐标刷新，不是真的要跳到新位置，这里跳过，避免把
  // 已经滚到的窗口重置回章节顶部。
  useEffect(() => {
    if (
      reportedAnchorRef.current &&
      reportedAnchorRef.current.book === book &&
      reportedAnchorRef.current.paragraph === paragraph
    ) {
      return;
    }
    let alive = true;
    setUnit(null);
    setError(null);
    (async () => {
      const start = await resolveStartParagraph(book, paragraph);
      if (start === null) throw new Error(t("common.loadFailed"));
      const u = await getReadingUnitAt(book, start);
      return { u, start };
    })()
      .then(({ u, start }) => {
        if (!alive || !u) return;
        unitRef.current = u;
        setUnit(u);
        // 以「请求的段」为窗口锚点，保证深链接/角标跳转的目标段一定在首屏窗口内。
        jumpTargetRef.current = start;
        setJumpNonce((n) => n + 1);
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : t("common.loadFailed"));
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, paragraph]);

  const p = unit?.from ?? paragraph ?? 0;
  const toc = headingToc ?? unit?.chapter?.toc ?? initialToc ?? title;

  // 与 `unit` 状态同步的 ref（回调里读最新值，避免闭包读到旧章节）。
  useEffect(() => {
    unitRef.current = unit;
  }, [unit]);

  // 卸载时清掉锚点防抖定时器，避免泄漏。
  useEffect(
    () => () => {
      if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
    },
    [],
  );

  // 上报当前阅读单元的锚点：外层用它算 / 重算义注复注对应章节（仅原文层
  // 触发重算，见 `ReaderScreen.tsx`），也用它刷新标签页顶部的章节标题。
  // 锚点 para 用「章节标题的段号」（unit.chapter.paragraph）而非 unit.from：
  // 硬切单元（如 [464..475]）的 from 是正文段，findRelatedChapters 对正文段
  // 查不到义注/复注，会在标题段↔正文段之间让伴读层时有时无、标签栏闪。
  useEffect(() => {
    if (unit) {
      const anchorPara = unit.chapter?.paragraph ?? unit.from;
      reportedAnchorRef.current = { book, paragraph: anchorPara };
      onChapterAnchor(book, anchorPara, headingToc ?? unit.chapter?.toc ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, headingToc, book]);

  // 没指定版本时自动选版本 —— 新接口必须带 channel。
  //
  // 顺序：本地已有内容的版本（下载过的优先）→ 接口列表里的同名版本 →
  // `_System_Pali_VRI_`。先看本地有两个好处：下载过的书不必等一次网络就能
  // 直接命中缓存（否则滑到义注层要先转圈），也不会挑到一个本地没数据的
  // 版本 —— 那正是「刚下载完的原文滑过去却变成 _System_Pali_VRI_」的原因。
  useEffect(() => {
    if (channelId || !unit) return;
    let alive = true;
    (async () => {
      const local = await localChannelsFor(book);
      if (!alive) return false;
      const localPick =
        (preferredChannelUid
          ? local.find((c) => c.channelId === preferredChannelUid)
          : undefined) ??
        local.find((c) => c.downloaded) ??
        local[0];
      if (localPick) {
        setChannelId(localPick.channelId);
        setChannelName(localPick.name ?? undefined);
        return true;
      }
      return false;
    })()
      .then((done) => {
        if (done || !alive) return;
        return getBookChannels(book, unit.from).then((list) => {
          if (!alive) return;
          // 记下 id→名字，下次可以离线选版本。
          for (const c of list) void rememberChannelName(c.channel_id, c.name);
          // 先按 uid 认，认不到再退回按名字（老记录可能只有名字）。
          const preferred =
            (preferredChannelUid
              ? list.find((c) => c.channel_id === preferredChannelUid)
              : undefined) ??
            (preferredChannelName
              ? list.find((c) => c.name === preferredChannelName)
              : undefined);
          const fallback = list.find((c) => c.name === FALLBACK_CHANNEL_NAME);
          const picked = preferred ?? fallback;
          if (!picked) {
            // 列表为空但明确知道上一层用的版本（义注/复注层沿用原文层的版本 uid）：
            // 部分后端/测试库缺「版本列表」接口数据时，仍直接沿用该 uid 取正文，
            // 而不是报「无版本」。正文接口（tipitaka-read-para）按 channel 直接可用。
            if (preferredChannelUid) {
              setChannelId(preferredChannelUid);
              setChannelName(preferredChannelName ?? undefined);
              return;
            }
            setError(t("reader.noVersions"));
            return;
          }
          setChannelId(picked.channel_id);
          setChannelName(picked.name);
        });
      })
      .catch(() => {
        /* 频道列表拿不到时下面的正文加载会报错，这里不重复提示 */
      });
    return () => {
      alive = false;
    };
  }, [book, channelId, unit, preferredChannelUid, preferredChannelName, t]);

  // 当前版本的名字也记一份 —— 从目录/书架带进来的版本同样要能离线复用。
  useEffect(() => {
    if (channelId && channelName)
      void rememberChannelName(channelId, channelName);
  }, [channelId, channelName]);

  // 版本一变（自动选定或手动切换）就告诉外层，供其他层第一次加载时参考。
  useEffect(() => {
    onChannelChange?.(channelId, channelName);
  }, [channelId, channelName, onChannelChange]);

  // 记录阅读位置（本地存储，见 src/data/history.ts）——每一层各自的书各算一条。
  useEffect(() => {
    if (!unit) return;
    // 只存版本 uid，不存名字：名字查 channels 表（见 history.ts 注释）。
    saveReadingRecord({
      book,
      // 连续滚动时存「视口顶部段」而非章节起点，恢复阅读位置更精确。
      paragraph: topParaRef.current || unit.from,
      title,
      heading: toc,
      channelId,
      updatedAt: Date.now(),
    });
  }, [book, unit, title, toc, channelId]);

  // 副标题只放版本名，不放「段落 from–to」——连续滚动下锚点单元(unit)随时在变，
  // 若把 unit 依赖带进 WebView source，跨章时会让整个 WebView 重载、窗口被重置回
  // 初始段（表现为段被反复卸载、滚动位置跳回）。
  const headerSubtitle = channelName ?? "";

  // 载入正文窗口：先取本书段落范围与字符数，按锚点算初始窗口，再查缓存→补缺口
  // → 只把窗口内的段落拼进首屏 HTML。窗口之外的段随滚动增量加载（wl-need）。
  useEffect(() => {
    const target = jumpTargetRef.current;
    if (!channelId || target == null) return;
    let alive = true;
    const token = ++loadTokenRef.current;
    setDoc(null);
    setError(null);
    // 重载/跳转时清掉旧标题，等新窗口的 wl-anchor 再更新（否则会残留上一本书的经名）。
    headingTocRef.current = null;
    setHeadingToc(null);
    (async () => {
      const sql = await tipitakaRunner();
      const [bounds, lengths, headings] = await Promise.all([
        bookBounds(sql, book),
        paragraphLengths(sql, book),
        getBookHeadingRows(book),
      ]);
      if (!alive || token !== loadTokenRef.current) return;
      if (!bounds) throw new Error(t("common.loadFailed"));

      const win = initialWindow(lengths, bounds, target, WINDOW_STRLEN);
      const map = await loadParasMap(channelId, book, win.from, win.to);
      if (!alive || token !== loadTokenRef.current) return;

      boundsRef.current = bounds;
      lengthsRef.current = lengths;
      headingsRef.current = headings;
      winRef.current = win;
      topParaRef.current = target;

      const parts: string[] = [];
      for (let p = win.from; p <= win.to; p++) {
        const html = renderParaHtml(p, map.get(p), headings);
        if (html) parts.push(html);
      }
      console.log(
        `[wl] init book=${book} window=[${win.from}..${win.to}] paras=${win.to - win.from + 1} non-empty=${parts.length}`,
      );
      const titleText = unitRef.current?.chapter?.toc ?? initialToc ?? title;
      setDoc({ title: titleText, body: parts.join("\n") });
    })().catch((err) => {
      if (alive && token === loadTokenRef.current) {
        setError(err instanceof Error ? err.message : t("common.loadFailed"));
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, channelId, jumpNonce]);

  // 上一 / 下一单元是否存在（异步算，用于禁用导航按钮）
  useEffect(() => {
    if (!unit) {
      setHasPrev(false);
      setHasNext(false);
      return;
    }
    let alive = true;
    Promise.all([getPrevUnit(unit), getNextUnit(unit)]).then(([prev, next]) => {
      if (!alive) return;
      setHasPrev(!!prev);
      setHasNext(!!next);
    });
    return () => {
      alive = false;
    };
  }, [unit]);

  const [readerWidth, setReaderWidth] = useState(0);
  const sidenoteMode: "inline" | "margin" =
    readerWidth >= SIDENOTE_MARGIN_MIN_WIDTH ? "margin" : "inline";
  const measure = useMemo(() => {
    if (!readerWidth) return MAX_CONTENT_WIDTH.medium ?? 720;
    const cap = MAX_CONTENT_WIDTH[widthClassOf(readerWidth)] ?? readerWidth;
    const usable =
      sidenoteMode === "margin"
        ? readerWidth - SIDENOTE_WIDTH - 24
        : readerWidth;
    return Math.max(280, Math.min(cap, usable));
  }, [readerWidth, sidenoteMode]);

  // 巴利字体：跟随界面语言或用户手工指定（见 src/pali/script/preference.ts）
  const { locale } = useI18n();
  const paliScript = resolvePaliScript(settings.paliScript, locale);

  /**
   * 正文只转服务端标了 `class='original'` 的段落；标题（章节 toc）本身就是
   * 巴利，整条转。译文频道一个字都不动。
   */
  const shown = useMemo<ReaderDoc | null>(() => {
    if (!doc || paliScript === "roman") return doc;
    return {
      ...doc,
      title: convertScript(doc.title, { from: "roman", to: paliScript }),
      body: convertPaliHtml(doc.body, { to: paliScript }),
    };
  }, [doc, paliScript]);

  const html = useMemo(
    () =>
      shown
        ? buildReaderHtml(
            { ...shown, subtitle: headerSubtitle },
            {
              fontSizePx: fontSizePx(settings.fontSize),
              dark: isDark,
              contentWidth: readerWidth,
              measure,
              sidenote: sidenoteMode,
              annoClamp: settings.annotationCollapsedLines,
              annotationMode: settings.annotationMode,
            },
          )
        : "",
    [
      shown,
      headerSubtitle,
      settings.fontSize,
      settings.annotationCollapsedLines,
      settings.annotationMode,
      isDark,
      readerWidth,
      measure,
      sidenoteMode,
    ],
  );

  // 目录跳转 / 上一章 / 下一章：更新锚点单元 + 把窗口移到目标段重新载入。
  // 连续滚动下「章节」只是锚点概念，正文窗口跨章节无缝衔接。
  const jumpTo = useCallback(
    (u: ReadingUnit, para: number) => {
      unitRef.current = u;
      setUnit(u);
      jumpTargetRef.current = para;
      setJumpNonce((n) => n + 1);
    },
    [],
  );

  const navigateTo = (b: number, para: number) => {
    if (b !== book) return;
    getReadingUnitAt(b, para).then((u) => {
      if (u) jumpTo(u, para);
    });
  };

  const goNext = () => {
    if (!unit) return;
    getNextUnit(unit).then((n) => {
      if (n) jumpTo(n, n.from);
    });
  };

  const goPrev = () => {
    if (!unit) return;
    getPrevUnit(unit).then((prev) => {
      if (prev) jumpTo(prev, prev.from);
    });
  };

  const openVersion = () => {
    setVersionVisible(true);
    setChannels(null);
    setChannelsError(null);
    getBookChannels(book, p)
      .then(setChannels)
      .catch((e) =>
        setChannelsError(
          e instanceof Error ? e.message : t("common.loadFailed"),
        ),
      );
  };

  const pickChannel = (ch: ChapterChannel) => {
    // 换版本要保持当前阅读位置：以视口顶部段（或锚点单元起点）为窗口锚点。
    jumpTargetRef.current =
      topParaRef.current || unitRef.current?.from || paragraph || 0;
    setChannelId(ch.channel_id);
    setChannelName(ch.name);
    setVersionVisible(false);
  };

  const askAboutParagraph = async () => {
    if (!(await ensureAiAvailable(t))) return;
    const para = topParaRef.current || p;
    navigation.navigate("NewChat", {
      passageRef: { book, paragraph: para, title: toc },
      systemPrompt: passageSystemPrompt(book, para, channelId),
      seedText: `关于《${title}》「${toc}」这一段落，请讲解大意。`,
    });
  };

  /**
   * 选中正文后的上下文菜单（复制 / 查词 / 提问）。
   *
   * `menuItems` 非空时 react-native-webview 会用它**整个重建** ActionMode 菜单，
   * 系统自带的复制/全选/网页搜索都不再出现 —— 所以「复制」也得自己实现。
   */
  const menuItems = useMemo(
    () => [
      { label: t("reader.menu.copy"), key: "copy" },
      { label: t("reader.menu.lookup"), key: "lookup" },
      { label: t("reader.menu.ask"), key: "ask" },
    ],
    [t],
  );

  const onMenuSelection = async (e: {
    nativeEvent: { key: string; selectedText: string };
  }) => {
    const { key, selectedText } = e.nativeEvent;
    const text = (selectedText ?? "").trim();
    if (!text) return;

    if (key === "copy") {
      await Clipboard.setStringAsync(text);
      return;
    }

    // 查词 / 提问都落到「探索」对话，带上章节坐标当系统提示词。
    // 屏幕上可能是缅文/泰文，但送给模型的必须是罗马巴利 —— 复制走的是用户
    // 看到的样子，查词问的是词本身。
    const pali = scriptToRoman(text, paliScript);
    if (!(await ensureAiAvailable(t))) return;
    const para = topParaRef.current || p;
    const common = {
      passageRef: { book, paragraph: para, title: toc },
      systemPrompt: passageSystemPrompt(book, para, channelId),
    } as const;
    if (key === "lookup") {
      // 查词是个完整的问题，直接替用户发出去。
      navigation.navigate("NewChat", {
        ...common,
        seedText: t("chat.lookupSeed", { text: pali }),
      });
    } else {
      // 提问只预填开头，问题本身让用户自己写完再发。
      navigation.navigate("NewChat", {
        ...common,
        draftText: t("chat.askDraft", { text: pali }),
      });
    }
  };

  // <cite> 跳转 + 角标跨栏高亮：WebView 点击 .anno-jump / .sidenote-number 时 postMessage。
  // 目标层在加载完成（onLoadEnd）或已加载（highlightSid 变化）时注入 JS 滚动并高亮。
  const webViewRef = useRef<WebView>(null);
  const pendingHighlightRef = useRef<string | null>(null);

  const injectHighlight = (sid: string) => {
    const js = `
      (function () {
        var el = document.querySelector('[data-sid="${sid}"]');
        if (el) {
          el.scrollIntoView({ block: "center" });
          el.classList.add("anno-highlight");
          setTimeout(function () { el.classList.remove("anno-highlight"); }, 2200);
        }
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
  };

  // 增量加载的段落同样要过一遍巴利字体转换（与首屏 `shown` 一致）。
  const convertFragment = useCallback(
    (fragment: string): string =>
      paliScript === "roman"
        ? fragment
        : convertPaliHtml(fragment, { to: paliScript }),
    [paliScript],
  );

  /**
   * WebView 滚动到边缘（上/下）请求更多段落：按 `WINDOW_STRLEN` 巴利文字符
   * 扩窗口，只取新增段 → 注入 `__wlAppend` / `__wlPrepend`（见 buildReaderHtml）。
   */
  const handleWlNeed = useCallback(
    (dir: "down" | "up", domFirst?: number, domLast?: number) => {
      const win = winRef.current;
      const bounds = boundsRef.current;
      const lengths = lengthsRef.current;
      const cid = channelId;
      if (!win || !bounds || !lengths || !cid) return;

      // 加载起点以 DOM 实际边缘为准：底部/顶部卸载会让 DOM 边缘比 winRef 逻辑
      // 边缘更靠里，若按逻辑边缘取数会在被卸载处留下「洞」（如 56 直接接 66）。
      // WebView 未上报或上报值越界（如旧 WebView 的过期消息）时回退到逻辑边缘。
      const base =
        dir === "down"
          ? domLast != null && domLast >= win.from && domLast <= win.to
            ? domLast
            : win.to
          : domFirst != null && domFirst >= win.from && domFirst <= win.to
            ? domFirst
            : win.from;

      if (dir === "down" && base >= bounds.hi) return;
      if (dir === "up" && base <= bounds.lo) return;

      const baseWin =
        dir === "down"
          ? { from: win.from, to: base }
          : { from: base, to: win.to };
      const next = extendWindow(lengths, bounds, baseWin, dir, WINDOW_STRLEN);
      const range: [number, number] =
        dir === "down" ? [base + 1, next.to] : [next.from, base - 1];
      if (range[0] > range[1]) return;

      // 在途去重：快速滚动会连发 wl-need，同一方向还没取完就跳过，避免重复请求/写库。
      if (loadingRef.current[dir]) {
        console.log(`[wl] need ${dir}: skipped (already in-flight)`);
        return;
      }
      loadingRef.current[dir] = true;

      console.log(
        `[wl] need ${dir}: window=[${win.from}..${win.to}] dom=[${domFirst}..${domLast}] → load paras=[${range[0]}..${range[1]}]`,
      );

      // 先亮起「加载方向」指示，再取数 —— 防止快速滑到底看到一片空白。
      webViewRef.current?.injectJavaScript(
        `window.__wlShowLoading(${JSON.stringify(dir)}); true;`,
      );
      const hideLoading = () =>
        webViewRef.current?.injectJavaScript(
          `window.__wlHideLoading(${JSON.stringify(dir)}); true;`,
        );

      void loadParasMap(cid, book, range[0], range[1])
        .then((map) => {
          // 期间发生了跳转/换版 → 窗口已重置，丢弃这次增量注入。
          if (winRef.current !== win) {
            hideLoading();
            return;
          }
          const parts: string[] = [];
          for (let p = range[0]; p <= range[1]; p++) {
            const html = renderParaHtml(p, map.get(p), headingsRef.current);
            if (html) parts.push(convertFragment(html));
          }
          // 逻辑窗口只向前扩：backfill 被卸载的洞时不回退边界。
          winRef.current =
            dir === "down"
              ? { from: win.from, to: Math.max(win.to, next.to) }
              : { from: Math.min(win.from, next.from), to: win.to };
          const htmlStr = parts.join("\n");
          if (!htmlStr) {
            hideLoading();
            return;
          }
          const fn = dir === "down" ? "__wlAppend" : "__wlPrepend";
          console.log(
            `[wl] ${dir} done: appended ${parts.length} paras (${htmlStr.length} html chars)`,
          );
          // __wlAppend / __wlPrepend 内部会先 __wlHideLoading(dir) 再插入正文。
          webViewRef.current?.injectJavaScript(
            `window.${fn}(${JSON.stringify(htmlStr)}); true;`,
          );
        })
        .catch((err) => {
          console.warn(
            `[wl] ${dir} failed:`,
            err instanceof Error ? err.message : err,
          );
          hideLoading();
        })
        .finally(() => {
          loadingRef.current[dir] = false;
        });
    },
    [book, channelId, convertFragment],
  );

  /**
   * WebView 上报视口顶部段：更新 `topParaRef`；当它跨入新的阅读单元时更新
   * 锚点单元（触发标题刷新、阅读记录、伴读层坐标重算）。
   */
  const handleWlAnchor = useCallback(
    (para: number) => {
      topParaRef.current = para;
      // 防抖提交：滚动补偿的 ±1px 抖动会让顶部段在章节边界（尤其空标题段，如
      // 435↔437 中间隔着空段 436）来回跳，直接跟会连锁触发标题/伴读层反复刷新。
      if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
      anchorTimerRef.current = setTimeout(() => {
        const ht = headingTocFor(book, para);
        if (ht !== headingTocRef.current) {
          headingTocRef.current = ht;
          setHeadingToc(ht);
        }
        const u = unitRef.current;
        if (u && para >= u.from && para <= u.to) return; // 仍在同一章节单元内
        // 锚点用「章节」单元（正文段归其所属章节），不用续读单元。
        getChapterUnitAt(book, para).then((nu) => {
          if (!nu) return;
          const cur = unitRef.current;
          if (cur && cur.book === nu.book && cur.from === nu.from) return;
          unitRef.current = nu;
          setUnit(nu);
          console.log(
            `[wl] anchor para=${para} → unit book=${book} [${nu.from}..${nu.to}] "${nu.chapter?.toc ?? ""}"`,
          );
        });
      }, 250);
    },
    [book],
  );

  useEffect(() => {
    if (!highlightSid) return;
    pendingHighlightRef.current = highlightSid;
    injectHighlight(highlightSid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightSid, doc]);

  const handleAnnoMessage = (e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (!msg) return;
      if (msg.type === "wl-need" && (msg.dir === "down" || msg.dir === "up")) {
        handleWlNeed(msg.dir, Number(msg.domFirst), Number(msg.domLast));
        return;
      }
      if (msg.type === "wl-anchor" && typeof msg.para === "number") {
        handleWlAnchor(msg.para);
        return;
      }
      if (msg.type === "wl-unload" && (msg.dir === "up" || msg.dir === "down")) {
        console.log(
          `[wl] unload ${msg.dir}: paras=[${msg.from}..${msg.to}] count=${msg.count}` +
            ` | domFirst=${msg.domFirst} domCount=${msg.domCount} scrollTop=${msg.scrollTop}`,
        );
        return;
      }
      const book = Number(msg.book);
      const para = Number(msg.para);
      const start = Number(msg.start);
      const end = Number(msg.end);
      if (msg.type === "anno-jump") {
        onAnnoJump(book, para, start, end);
      } else if (msg.type === "cross-highlight") {
        onCrossHighlight(book, para, start, end);
      }
    } catch {
      // 忽略非 JSON / 非跳转消息
    }
  };

  const handleAnnoLoadEnd = () => {
    // 诊断：每次 WebView loadEnd 都打点，用于判断滚动中是否发生整页重载。
    console.log("[wl] webview loadEnd");
    const sid = pendingHighlightRef.current;
    if (!sid) return;
    pendingHighlightRef.current = null;
    injectHighlight(sid);
  };

  return (
    <View style={[styles.pane, { backgroundColor: c.paper }]}>
      {/* 导航条：目录 / 上一章 / 下一章 / 版本切换 / 离线下载（这一层自己的书） */}
      <View
        style={[
          styles.navBar,
          { backgroundColor: c.paperRaised, borderBottomColor: c.hairline },
        ]}
      >
        <NavBtn
          icon="list-outline"
          c={c}
          onPress={() => {
            if (listDetail) {
              if (!paneOpen) setPanePinned(true);
              setPaneOpen((v) => !v);
            } else {
              setDrawerVisible(true);
            }
          }}
        />
        <NavBtn
          icon="chevron-back"
          label={t("reader.prevChapter")}
          disabled={!hasPrev}
          c={c}
          onPress={goPrev}
        />
        <NavBtn
          icon="chevron-forward"
          label={t("reader.nextChapter")}
          iconPosition="right"
          disabled={!hasNext}
          c={c}
          onPress={goNext}
        />
        <NavBtn
          icon="layers-outline"
          label={t("reader.version")}
          c={c}
          onPress={openVersion}
        />
        <View style={styles.navBtn}>
          {channelId ? (
            <DownloadIconButton
              book={book}
              channelId={channelId}
              color={c.ink}
              size={18}
            />
          ) : (
            <Ionicons
              name="cloud-download-outline"
              size={18}
              color={c.inkFaint}
            />
          )}
        </View>
      </View>

      <View style={styles.bodyRow}>
        {listDetail && paneOpen ? (
          <View
            style={[
              styles.listPane,
              {
                width: LIST_PANE_WIDTH,
                backgroundColor: c.paperRaised,
                borderRightColor: c.hairline,
              },
            ]}
          >
            <ChapterTree
              book={book}
              currentParagraph={p}
              c={c}
              onSelect={(b, para) => {
                navigateTo(b, para);
                if (!panePinned) setPaneOpen(false);
              }}
            />
          </View>
        ) : null}
        <View
          style={styles.body}
          onLayout={(e) =>
            setReaderWidth(Math.round(e.nativeEvent.layout.width))
          }
        >
          {error ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline" size={40} color={c.inkFaint} />
              <Text style={[styles.centerText, { color: c.inkSoft }]}>
                {error}
              </Text>
            </View>
          ) : !doc ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.vermilion} />
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              source={{ html }}
              originWhitelist={["*"]}
              style={[styles.web, { backgroundColor: c.paper }]}
              setSupportMultipleWindows={false}
              menuItems={menuItems}
              onCustomMenuSelection={(e) => void onMenuSelection(e)}
              onMessage={handleAnnoMessage}
              onLoadEnd={handleAnnoLoadEnd}
            />
          )}
        </View>
      </View>

      <Pressable
        style={[styles.askFab, { backgroundColor: c.vermilion }]}
        onPress={() => void askAboutParagraph()}
      >
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={17}
          color="#fdfaf1"
        />
        <Text style={styles.askFabText}>{t("reader.askAboutPassage")}</Text>
      </Pressable>

      <ChapterDrawer
        visible={drawerVisible}
        book={book}
        currentParagraph={p}
        dark={isDark}
        onClose={() => setDrawerVisible(false)}
        onSelect={(b, para) => {
          navigateTo(b, para);
          setDrawerVisible(false);
        }}
      />

      <VersionSheet
        visible={versionVisible}
        channels={channels}
        channelsError={channelsError}
        activeChannelId={channelId}
        c={c}
        onClose={() => setVersionVisible(false)}
        onPick={pickChannel}
      />
    </View>
  );
}

function VersionSheet({
  visible,
  channels,
  channelsError,
  activeChannelId,
  c,
  onClose,
  onPick,
}: {
  visible: boolean;
  channels: ChapterChannel[] | null;
  channelsError: string | null;
  activeChannelId?: string;
  c: ReaderChrome;
  onClose: () => void;
  onPick: (ch: ChapterChannel) => void;
}) {
  const t = useT();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.sheetBackdrop, { backgroundColor: c.backdrop }]}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.paperRaised, borderTopColor: c.border },
        ]}
      >
        <Text
          style={[styles.sheetTitle, { color: c.ink, fontFamily: serifFont }]}
        >
          {t("reader.switchVersion")}
        </Text>
        {channelsError ? (
          <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
            {channelsError}
          </Text>
        ) : !channels ? (
          <View style={styles.versionLoading}>
            <ActivityIndicator color={c.vermilion} />
          </View>
        ) : channels.length === 0 ? (
          <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
            {t("reader.noVersions")}
          </Text>
        ) : (
          <ScrollView style={styles.versionList}>
            {channels.map((ch) => {
              const active = ch.channel_id === activeChannelId;
              return (
                <Pressable
                  key={ch.uid}
                  style={[
                    styles.versionRow,
                    {
                      backgroundColor: active ? c.paperSunken : "transparent",
                      borderBottomColor: c.hairline,
                    },
                  ]}
                  onPress={() => onPick(ch)}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.versionName,
                      {
                        color: active ? c.vermilion : c.ink,
                        fontWeight: active ? "700" : "400",
                      },
                    ]}
                  >
                    {ch.name}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={c.vermilion} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/**
 * 「查词 / 提问 / 就此段落提问」共用的系统提示词：告诉模型用户正看着哪一段、
 * 哪个版本，让它先去查原文与译文，而不是凭空作答。
 */
function passageSystemPrompt(
  book: number,
  para: number,
  channelUid?: string,
): string {
  return `用户正在阅读巴利文献章节 ${book}-${para} channel:${channelUid ?? ""} 段落号${para} 。请根据原文，译文，和 该处相关资料回答用户的问题。`;
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
  },
  navBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
  },
  navBtnLabel: {
    fontSize: 12,
  },
  bodyRow: {
    flex: 1,
    flexDirection: "row",
  },
  body: {
    flex: 1,
  },
  listPane: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  web: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  centerText: {
    fontSize: 13,
  },
  askFab: {
    position: "absolute",
    right: 16,
    bottom: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  askFabText: {
    color: "#fdfaf1",
    fontSize: 13,
    fontWeight: "600",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 32,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 12,
  },
  sheetSection: {
    fontSize: 13,
    marginTop: 8,
    marginBottom: 8,
  },
  versionLoading: {
    paddingVertical: 24,
    alignItems: "center",
  },
  versionList: {
    maxHeight: 320,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  versionName: {
    flex: 1,
    fontSize: 15,
    paddingRight: 12,
  },
});
