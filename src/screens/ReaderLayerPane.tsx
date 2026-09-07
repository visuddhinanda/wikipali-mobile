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
import React, { useEffect, useMemo, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getBookChannels } from "../api";
import {
  getNextUnit,
  getPrevUnit,
  getReadingUnitAt,
  getReadingUnitContent,
  resolveStartParagraph,
  type ReadingUnit,
} from "../reading";
import type { ChapterChannel } from "../catalog";
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
import { useT } from "../i18n/I18nContext";
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
  preferredChannelName?: string;
  settings: ReaderSettings;
  /** 每次这一层的阅读单元变化都会调用（含首次进入），供外层算/重算义注复注章节。 */
  onChapterAnchor: (book: number, paragraph: number, toc: string | null) => void;
  /** 版本变化（自动选定或手动切换）都会调用，供外层记住「当前偏好的版本名」，义注/复注第一次加载时接着用。 */
  onChannelChange?: (channelName: string | undefined) => void;
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
  },
): string {
  const vars = opts.dark
    ? "--paper:#211d17;--ink:#e8dfd0;--ink-soft:#bfb198;--ink-faint:#8f8166;--vermilion:#d17a67;--hairline:#3a3227;"
    : "--paper:#f7f3ea;--ink:#3a3128;--ink-soft:#6b5f4e;--ink-faint:#9a8c76;--vermilion:#8c3b2e;--hairline:#d8cdb4;";
  return `<!DOCTYPE html>
<html lang="zh" data-sidenote="${opts.sidenote}" data-content-width="${opts.contentWidth}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    ${vars}
    --base:${opts.fontSizePx}px;
    --measure:${opts.measure}px;
    --sidenote-w:${SIDENOTE_WIDTH}px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: Georgia, "Songti SC", "Noto Serif SC", serif;
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
  .doc-title { font-size: 1.45em; font-weight: 700; margin: 8px 0 4px; }
  .doc-subtitle { color: var(--ink-soft); font-size: 0.82em; margin-bottom: 24px; }

  .original, .translation { margin: 0 0 0.55em; }
  .original::after, .translation::after { content: ""; display: block; clear: both; }
  [data-para]::before {
    content: attr(data-para);
    float: left;
    min-width: 1.8em;
    margin-right: 0.5em;
    margin-top: 0.22em;
    text-align: right;
    color: var(--ink-faint);
    font-size: 0.6em;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
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

  .margin-toggle { display: none; }
  .sidenote-number {
    color: var(--vermilion);
    cursor: pointer;
    vertical-align: super;
    font-size: 0.72em;
    margin-left: 2px;
  }
  .sidenote {
    display: block;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--ink-soft);
    border-left: 2px solid var(--hairline);
    padding-left: 10px;
    margin: 4px 0 18px;
  }
  [data-sidenote="margin"] .sidenote {
    float: right;
    clear: right;
    width: var(--sidenote-w);
    margin-right: calc(-1 * (var(--sidenote-w) + 24px));
    margin-top: 4px;
    border-left: none;
    border-top: 2px solid var(--hairline);
    padding: 4px 0 0;
  }
</style>
</head>
<body>
  <div class="paper">
    <div class="doc-title">${doc.title}</div>
    ${doc.subtitle ? `<div class="doc-subtitle">${doc.subtitle}</div>` : ""}
    ${doc.body}
  </div>
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
    <Pressable style={styles.navBtn} disabled={disabled} onPress={onPress} hitSlop={4}>
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
  preferredChannelName,
  settings,
  onChapterAnchor,
  onChannelChange,
  navigation,
}: ReaderLayerPaneProps) {
  const t = useT();

  const [unit, setUnit] = useState<ReadingUnit | null>(null);
  const [channelId, setChannelId] = useState<string | undefined>(initialChannelId);
  const [channelName, setChannelName] = useState<string | undefined>(initialChannelName);
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const { listDetail } = useLayout();
  const [paneOpen, setPaneOpen] = useState(false);
  const [panePinned, setPanePinned] = useState(false);
  const [versionVisible, setVersionVisible] = useState(false);
  const [channels, setChannels] = useState<ChapterChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const c = readerColors(settings.theme === "dark");
  const isDark = settings.theme === "dark";

  // 进入 / 换章：定位阅读单元。paragraph 有值（义注/复注层恒有值，原文层
  // 是目录点击或深链接）就直接用；原文层未指定则续读上次位置或本书第一章。
  useEffect(() => {
    let alive = true;
    setUnit(null);
    setError(null);
    (async () => {
      const start = await resolveStartParagraph(book, paragraph);
      if (start === null) throw new Error(t("common.loadFailed"));
      return getReadingUnitAt(book, start);
    })()
      .then((u) => {
        if (alive) setUnit(u);
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
  const toc = unit?.chapter?.toc ?? initialToc ?? title;

  // 上报当前阅读单元的锚点：外层用它算 / 重算义注复注对应章节（仅原文层
  // 触发重算，见 `ReaderScreen.tsx`），也用它刷新标签页顶部的章节标题。
  useEffect(() => {
    if (unit) onChapterAnchor(book, unit.from, unit.chapter?.toc ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, book]);

  // 没指定版本时自动选版本 —— 新接口必须带 channel。
  useEffect(() => {
    if (channelId || !unit) return;
    let alive = true;
    getBookChannels(book, unit.from)
      .then((list) => {
        if (!alive) return;
        // 优先接着用当前偏好的版本（比如原文用的「deepseek」）；这本书没有
        // 同名版本就降级到「_System_Pali_VRI_」（巴利原文，各书基本都有）；
        // 连这个都没有才是真没数据 —— 不再无脑取列表第一个凑合。
        const preferred = preferredChannelName
          ? list.find((c) => c.name === preferredChannelName)
          : undefined;
        const fallback = list.find((c) => c.name === FALLBACK_CHANNEL_NAME);
        const picked = preferred ?? fallback;
        if (!picked) {
          setError(t("reader.noVersions"));
          return;
        }
        setChannelId(picked.channel_id);
        setChannelName(picked.name);
      })
      .catch(() => {
        /* 频道列表拿不到时下面的正文加载会报错，这里不重复提示 */
      });
    return () => {
      alive = false;
    };
  }, [book, channelId, unit, preferredChannelName, t]);

  // 版本一变（自动选定或手动切换）就告诉外层，供其他层第一次加载时参考。
  useEffect(() => {
    onChannelChange?.(channelName);
  }, [channelName, onChannelChange]);

  // 记录阅读位置（本地存储，见 src/data/history.ts）——每一层各自的书各算一条。
  useEffect(() => {
    if (!unit) return;
    saveReadingRecord({
      book,
      paragraph: unit.from,
      title,
      heading: toc,
      channelId,
      channelName,
      updatedAt: Date.now(),
    });
  }, [book, unit, title, toc, channelId, channelName]);

  const rangeLabel = unit ? `段落 ${unit.from}–${unit.to}` : "";
  const headerSubtitle = [channelName, rangeLabel].filter(Boolean).join(" · ");

  // 载入正文：查本地缓存 → 只补缺口 → 拼段落 HTML（docs/reading-content.md §4.3）
  useEffect(() => {
    if (!unit || !channelId) return;
    let alive = true;
    setDoc(null);
    setError(null);
    getReadingUnitContent(unit, channelId)
      .then((d) => {
        if (alive) setDoc({ title: toc, body: d.html });
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : t("common.loadFailed"));
        }
      });
    return () => {
      alive = false;
    };
  }, [unit, channelId, toc]);

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
      sidenoteMode === "margin" ? readerWidth - SIDENOTE_WIDTH - 24 : readerWidth;
    return Math.max(280, Math.min(cap, usable));
  }, [readerWidth, sidenoteMode]);

  const html = useMemo(
    () =>
      doc
        ? buildReaderHtml(
            { ...doc, subtitle: headerSubtitle },
            {
              fontSizePx: fontSizePx(settings.fontSize),
              dark: isDark,
              contentWidth: readerWidth,
              measure,
              sidenote: sidenoteMode,
            },
          )
        : "",
    [doc, headerSubtitle, settings.fontSize, isDark, readerWidth, measure, sidenoteMode],
  );

  const navigateTo = (b: number, para: number) => {
    if (b !== book) return;
    getReadingUnitAt(b, para).then((u) => {
      if (u) setUnit(u);
    });
  };

  const goNext = () => {
    if (!unit) return;
    getNextUnit(unit).then((n) => {
      if (n) setUnit(n);
    });
  };

  const goPrev = () => {
    if (!unit) return;
    getPrevUnit(unit).then((prev) => {
      if (prev) setUnit(prev);
    });
  };

  const openVersion = () => {
    setVersionVisible(true);
    setChannels(null);
    setChannelsError(null);
    getBookChannels(book, p)
      .then(setChannels)
      .catch((e) =>
        setChannelsError(e instanceof Error ? e.message : t("common.loadFailed")),
      );
  };

  const pickChannel = (ch: ChapterChannel) => {
    setChannelId(ch.channel_id);
    setChannelName(ch.name);
    setVersionVisible(false);
  };

  const askAboutParagraph = async () => {
    if (!(await ensureAiAvailable(t))) return;
    navigation.navigate("NewChat", {
      passageRef: { book, paragraph: p, title: toc },
      seedText: `关于《${title}》「${toc}」这一段落，请讲解大意。`,
    });
  };

  return (
    <View style={[styles.pane, { backgroundColor: c.paper }]}>
      {/* 导航条：目录 / 上一章 / 下一章 / 版本切换 / 离线下载（这一层自己的书） */}
      <View style={[styles.navBar, { backgroundColor: c.paperRaised, borderBottomColor: c.hairline }]}>
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
        <NavBtn icon="layers-outline" label={t("reader.version")} c={c} onPress={openVersion} />
        <View style={styles.navBtn}>
          {channelId ? (
            <DownloadIconButton book={book} channelId={channelId} color={c.ink} size={18} />
          ) : (
            <Ionicons name="cloud-download-outline" size={18} color={c.inkFaint} />
          )}
        </View>
      </View>

      <View style={styles.bodyRow}>
        {listDetail && paneOpen ? (
          <View
            style={[
              styles.listPane,
              { width: LIST_PANE_WIDTH, backgroundColor: c.paperRaised, borderRightColor: c.hairline },
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
        <View style={styles.body} onLayout={(e) => setReaderWidth(Math.round(e.nativeEvent.layout.width))}>
          {error ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline" size={40} color={c.inkFaint} />
              <Text style={[styles.centerText, { color: c.inkSoft }]}>{error}</Text>
            </View>
          ) : !doc ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.vermilion} />
            </View>
          ) : (
            <WebView
              source={{ html }}
              originWhitelist={["*"]}
              style={[styles.web, { backgroundColor: c.paper }]}
              setSupportMultipleWindows={false}
            />
          )}
        </View>
      </View>

      <Pressable
        style={[styles.askFab, { backgroundColor: c.vermilion }]}
        onPress={() => void askAboutParagraph()}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={17} color="#fdfaf1" />
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
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.sheetBackdrop, { backgroundColor: c.backdrop }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.paperRaised, borderTopColor: c.border }]}>
        <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serifFont }]}>
          {t("reader.switchVersion")}
        </Text>
        {channelsError ? (
          <Text style={[styles.sheetSection, { color: c.inkSoft }]}>{channelsError}</Text>
        ) : !channels ? (
          <View style={styles.versionLoading}>
            <ActivityIndicator color={c.vermilion} />
          </View>
        ) : channels.length === 0 ? (
          <Text style={[styles.sheetSection, { color: c.inkSoft }]}>{t("reader.noVersions")}</Text>
        ) : (
          <ScrollView style={styles.versionList}>
            {channels.map((ch) => {
              const active = ch.channel_id === activeChannelId;
              return (
                <Pressable
                  key={ch.uid}
                  style={[
                    styles.versionRow,
                    { backgroundColor: active ? c.paperSunken : "transparent", borderBottomColor: c.hairline },
                  ]}
                  onPress={() => onPick(ch)}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.versionName, { color: active ? c.vermilion : c.ink, fontWeight: active ? "700" : "400" }]}
                  >
                    {ch.name}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={18} color={c.vermilion} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
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
