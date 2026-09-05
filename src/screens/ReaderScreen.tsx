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
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getBookChannels, getChapterByChannel, getChapterContent } from "../api";
import {
  chapterEndParagraph,
  headingPath,
  nextHeading,
  prevHeading,
  resolveDisplayNode,
} from "../catalog/headings";
import type { ChapterChannel } from "../catalog";
import { saveReadingRecord } from "../data/history";
import { ChapterDrawer, ChapterTree } from "../components/ChapterDrawer";
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
import {
  FONT_OPTIONS,
  fontSizePx,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderFontSize,
  type ReaderSettings,
} from "../settings/reader";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;

interface ReaderDoc {
  title: string;
  subtitle?: string;
  body: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildReaderHtml(
  doc: ReaderDoc,
  opts: {
    fontSizePx: number;
    dark: boolean;
    /**
     * 阅读区净宽（dp）与正文限宽 —— 由 RN 层注入（`DESIGN.md` §4.7）。
     * WebView 内不再写 `@media`，否则会出现「RN 认为是平板、WebView 认为是手机」的错档。
     */
    contentWidth: number;
    measure: number;
    /** 边注形态：窄屏行内折叠 / 宽屏右侧 Tufte 边注栏。 */
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
  /* 边注栏模式下正文整体左移，右侧空出边注栏的宽度 */
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
  /* 宽屏：真 Tufte 边注，落在正文右侧留白里。开关由 RN 注入，不用 @media。 */
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
  disabled,
  c,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  c: ReaderChrome;
  onPress: () => void;
}) {
  const color = disabled ? c.inkFaint : c.ink;
  return (
    <Pressable
      style={styles.navBtn}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.navBtnLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ReaderScreen({ route, navigation }: Props) {
  const t = useT();
  const { book, paragraph, title } = route.params;

  const [settings, setSettings] = useState<ReaderSettings>({
    theme: "light",
    fontSize: "md",
  });
  // 当前要显示的章节起始段；初始为路由传入的 paragraph，导航（上一章/下一章/目录）时更新。
  const [activeParagraph, setActiveParagraph] = useState(paragraph);
  const [channelId, setChannelId] = useState<string | undefined>(
    route.params.channelId,
  );
  const [channelName, setChannelName] = useState<string | undefined>(
    route.params.channelName,
  );
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [drawerVisible, setDrawerVisible] = useState(false);
  // 宽屏 list-detail（DESIGN.md §4.6）：expanded 及以上把目录做成常驻左栏，
  // 选中一章后自动收起，把宽度让给正文；用户手动展开过一次后本次会话不再自动收起。
  const { listDetail } = useLayout();
  // 进入阅读器时用户已经选定章节，直接以收起态进入（深链接同理，DESIGN.md §4.6）
  const [paneOpen, setPaneOpen] = useState(false);
  const [panePinned, setPanePinned] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [versionVisible, setVersionVisible] = useState(false);
  const [channels, setChannels] = useState<ChapterChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const c = readerColors(settings.theme === "dark");
  const isDark = settings.theme === "dark";

  // 读取阅读器偏好（字号/主题）
  useEffect(() => {
    loadReaderSettings().then(setSettings);
  }, []);

  // 路由切换（进入新书/新章节）时重置显示段。
  useEffect(() => {
    setActiveParagraph(paragraph);
  }, [book, paragraph]);

  // 当前「显示单元」：由 activeParagraph 派生（输入章节体量过大时下沉到子章节）。
  const current = useMemo(
    () => resolveDisplayNode(book, activeParagraph),
    [book, activeParagraph],
  );

  const p = current?.heading.paragraph ?? activeParagraph;
  const toc = current?.heading.toc ?? title;

  // 记录阅读历史（本地存储，见 src/data/history.ts；TODO: 后续改 wikipali API）。
  useEffect(() => {
    saveReadingRecord({
      book,
      paragraph: p,
      title,
      heading: toc,
      channelId,
      channelName,
      updatedAt: Date.now(),
    });
  }, [book, p, title, toc, channelId, channelName]);

  // 标题面包屑：从「请求章节」到「当前显示单元」的父层级标题。
  // 例：93-3 → 93-5，父层级为 93-3(书) / 93-4，正文为 93-5 起的 5–11 段。
  const path = useMemo(() => headingPath(current), [current]);
  const breadcrumb = useMemo(() => {
    const ancestors = path.slice(0, -1);
    if (ancestors.length === 0) return title;
    return ancestors.map((h, i) => (i === 0 ? title : h.toc)).join(" › ");
  }, [path, title]);

  const rangeEnd = useMemo(
    () => (current ? chapterEndParagraph(current) : null),
    [current],
  );
  const rangeLabel = rangeEnd ? `段落 ${p}–${rangeEnd - 1}` : `段落 ${p}–末`;

  const headerTitle = toc;
  const headerSubtitle = [breadcrumb, channelName, rangeLabel]
    .filter(Boolean)
    .join(" · ");

  // 载入正文
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    const load = channelId
      ? getChapterByChannel(book, p, channelId).then((d) => ({
          title: toc,
          body: d.display ? d.display : escapeHtml(d.content),
        }))
      : getChapterContent(book, p).then((d) => ({
          title: toc,
          body: d.content,
        }));

    load
      .then((d) => {
        if (alive) setDoc(d);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : t("common.loadFailed"));
      });

    return () => {
      alive = false;
    };
  }, [book, channelId, channelName, p, toc]);

  // 阅读区净宽以 onLayout 实测为准：列表栏收起、窗口拖动都会改变它，
  // 双列 / 边注栏的开关按这个宽度判断，不按设备档位硬编码（DESIGN.md §4.7）。
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
    if (resolveDisplayNode(b, para)) setActiveParagraph(para);
  };

  const goNext = () => {
    if (!current) return;
    const n = nextHeading(current);
    if (n) navigateTo(n.book, n.paragraph);
  };

  const goPrev = () => {
    if (!current) return;
    const prev = prevHeading(current);
    if (prev) navigateTo(prev.book, prev.paragraph);
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

  const updateSettings = (next: ReaderSettings) => {
    setSettings(next);
    saveReaderSettings(next);
  };

  const askAboutParagraph = () => {
    navigation.navigate("NewChat", {
      passageRef: { book, paragraph: p, title: toc },
      seedText: `关于《${title}》「${toc}」这一段落，请讲解大意。`,
    });
  };

  const hasPrev = !!current && !!prevHeading(current);
  const hasNext = !!current && !!nextHeading(current);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.paper }]} edges={["top", "left", "right"]}>
      {/* 顶栏 */}
      <View style={[styles.header, { backgroundColor: c.paperRaised, borderBottomColor: c.hairline }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={c.ink} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>
            {headerTitle}
          </Text>
          <Text style={[styles.headerSubtitle, { color: c.inkSoft }]} numberOfLines={1}>
            {headerSubtitle}
          </Text>
        </View>
        <Pressable onPress={() => setSettingsVisible(true)} hitSlop={8}>
          <Ionicons name="settings-outline" size={22} color={c.ink} />
        </Pressable>
      </View>

      {/* 导航条：目录 / 上一章 / 下一章 / 版本切换 */}
      <View style={[styles.navBar, { backgroundColor: c.paperRaised, borderBottomColor: c.hairline }]}>
        <NavBtn
          icon="list-outline"
          label={t("reader.toc")}
          c={c}
          onPress={() => {
            if (listDetail) {
              // 手动展开过就固定住，不再自动收起
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
      </View>

      {/* 正文（宽屏为 list-detail 双栏：左列表 + 右阅读区） */}
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
                // 选中一章后自动收起（除非用户手动展开过）
                if (!panePinned) setPaneOpen(false);
              }}
            />
          </View>
        ) : null}
        <View
          style={styles.body}
          onLayout={(e) => setReaderWidth(Math.round(e.nativeEvent.layout.width))}
        >
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

      {/* 底部悬浮：就此段落提问 */}
      <Pressable style={[styles.askFab, { backgroundColor: c.vermilion }]} onPress={askAboutParagraph}>
        <Ionicons name="chatbubble-ellipses-outline" size={17} color="#fdfaf1" />
        <Text style={styles.askFabText}>{t("reader.askAboutPassage")}</Text>
      </Pressable>

      {/* 目录抽屉 */}
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

      {/* 设置弹层：字号 + 主题 */}
      <SettingsSheet
        visible={settingsVisible}
        settings={settings}
        c={c}
        onClose={() => setSettingsVisible(false)}
        onChange={updateSettings}
      />

      {/* 版本切换弹层 */}
      <VersionSheet
        visible={versionVisible}
        channels={channels}
        channelsError={channelsError}
        activeChannelId={channelId}
        c={c}
        onClose={() => setVersionVisible(false)}
        onPick={pickChannel}
      />
    </SafeAreaView>
  );
}

function SettingsSheet({
  visible,
  settings,
  c,
  onClose,
  onChange,
}: {
  visible: boolean;
  settings: ReaderSettings;
  c: ReaderChrome;
  onClose: () => void;
  onChange: (s: ReaderSettings) => void;
}) {
  const t = useT();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.sheetBackdrop, { backgroundColor: c.backdrop }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.paperRaised, borderTopColor: c.border }]}>
        <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serifFont }]}>
          {t("reader.settings")}
        </Text>

        <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
          {t("reader.fontSize")}
        </Text>
        <View style={styles.fontRow}>
          {FONT_OPTIONS.map((f) => {
            const active = settings.fontSize === f.id;
            return (
              <Pressable
                key={f.id}
                style={[
                  styles.fontPill,
                  { backgroundColor: active ? c.vermilion : c.paperSunken },
                ]}
                onPress={() => onChange({ ...settings, fontSize: f.id as ReaderFontSize })}
              >
                <Text style={{ color: active ? "#fdfaf1" : c.ink, fontSize: f.px }}>
                  {t(f.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
          {t("reader.theme")}
        </Text>
        <View style={styles.fontRow}>
          {(
            [
              { id: "light", labelKey: "reader.theme.light" },
              { id: "dark", labelKey: "reader.theme.dark" },
            ] as const
          ).map((opt) => {
            const active = settings.theme === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[
                  styles.fontPill,
                  { backgroundColor: active ? c.vermilion : c.paperSunken },
                ]}
                onPress={() => onChange({ ...settings, theme: opt.id })}
              >
                <Text style={{ color: active ? "#fdfaf1" : c.ink }}>
                  {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
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
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 12,
    textAlign: "center",
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
    fontSize: 13,
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
  fontRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  fontPill: {
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
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
