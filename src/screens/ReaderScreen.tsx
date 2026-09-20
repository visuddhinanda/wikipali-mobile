import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PagerView, {
  type PagerViewOnPageSelectedEvent,
} from "react-native-pager-view";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { bookEntryAt, bookLayerAt } from "../catalog";
import type { CommentaryLayer } from "../catalog/commentary";
import { getChapterLayers } from "../reading";
import { ReaderLayerPane } from "./ReaderLayerPane";
import { serifFont } from "../theme";
import { useLayout } from "../hooks/useLayout";
import { readerColors, type ReaderChrome } from "../theme/reader";
import { useI18n, useT } from "../i18n/I18nContext";
import {
  TARGET_LABELS,
  TARGET_SCRIPTS,
  resolvePaliScript,
  type PaliScriptPreference,
} from "../pali/script";
import {
  DEFAULT_READER_SETTINGS,
  FONT_OPTIONS,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "../settings/reader";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;

type Layer = CommentaryLayer;

interface PageMeta {
  layer: Layer;
  book: number;
  paragraph?: number;
  title: string;
  toc: string | null;
}

/** 作品名（level=1 的 toc），不是丛书名 —— 一个 book 文件可能含多部作品。 */
function bookTitleOf(book: number, paragraph?: number): string {
  return bookEntryAt(book, paragraph)?.toc ?? String(book);
}

/**
 * 义注复注对读（`docs/commentary-layers.md`）：原文 / 义注 / 复注三层。
 * 窄屏（手机）用 PagerView 左右滑动切换，一次一层；阅读区净宽够双列对照
 * （`canDualColumn`，即 `theme/breakpoints.ts` 的 `DUAL_COLUMN_MIN_WIDTH`，
 * 复用 §4.7 既有的双列断点）时，一次并排显示两层。
 *
 * 链路只能顺着走 —— 原文只能到义注，义注能回原文也能到复注，不允许原文
 * 直接跳复注：标签固定按 [原文, 义注, 复注] 排列。窄屏靠相邻限制（滑动天然
 * 如此，标签点击用 `Math.abs` 限制）；双列时两栏本身就带出了中间那一层，
 * 点哪个标签都直接可达，不必再限制相邻。
 *
 * 进入时只加载原文，同时算（不加载）义注/复注对应的章节坐标；某一层的
 * 正文要等它真正显示出来才取（`visited` 控制每一页的懒挂载，双列时一对
 * 两个都会立即加入）。
 */
export function ReaderScreen({ route, navigation }: Props) {
  const t = useT();
  const { book, paragraph, title, channelId, channelName } = route.params;

  const [settings, setSettings] = useState<ReaderSettings>(
    DEFAULT_READER_SETTINGS,
  );
  useEffect(() => {
    loadReaderSettings().then(setSettings);
  }, []);
  const handleChangeSettings = useCallback((next: ReaderSettings) => {
    setSettings(next);
    saveReaderSettings(next);
  }, []);

  // 入口这一层不一定是根本：从「义注」书进来时，标签栏该停在义注，而不是
  // 顶一个空的「原文」（bug：从义注/复注进来标签停在原文位置且只有原文）。
  const [pages, setPages] = useState<PageMeta[]>(() => [
    {
      layer: bookLayerAt(book, paragraph) ?? "mula",
      book,
      paragraph,
      title,
      toc: title,
    },
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const pagerRef = useRef<PagerView>(null);
  // 驱动重算的是「用户所在的那一层」，不再固定是第 0 页。
  const selfIndexRef = useRef(0);
  // 手势回调里读页数：Pan 只随 activeIndex 重建，闭包里的 pages 会过期。
  const pagesLenRef = useRef(1);
  pagesLenRef.current = pages.length;
  // 该层当前锚点，用来判断「章节锚点上报」是真换章了、还是同一章内 unit 细化。
  const selfAnchorRef = useRef<{ book: number; paragraph: number } | null>(
    null,
  );
  // 当前偏好的版本名（如「deepseek」）——义注/复注第一次加载时，用它在自己
  // 书的版本列表里找同名版本，而不是无脑取第一个（不然会跳去系统默认的
  // 逐字翻译版本，见 bug：根本用 deepseek，切到义注/复注却变成 _System_Wbw_VRI_）。
  // 认版本认 uid：显示名可能在服务端被改（「claude」→「Claude」），
  // 按名字匹配会认不出同一个版本，退化成 _System_Pali_VRI_。
  const preferredChannelRef = useRef<{ uid?: string; name?: string }>({
    uid: channelId,
    name: channelName,
  });
  const handleChannelChange = useCallback(
    (uid: string | undefined, name: string | undefined) => {
      if (uid) preferredChannelRef.current = { uid, name };
    },
    [],
  );

  const [settingsVisible, setSettingsVisible] = useState(false);

  // 双列对照：阅读区净宽（onLayout 实测）达到 canDualColumn 的阈值就并排
  // 显示两层，否则退回单层 + 滑动（DESIGN.md §4.7）。
  const layout = useLayout();
  const [bodyWidth, setBodyWidth] = useState(0);
  const dual = layout.canDualColumn(bodyWidth);
  // 双列窗口的左边界，跟 activeIndex 分开记：点一个已经在窗口里的标签只是
  // 换高亮，不该把窗口挪走；只有点窗口外的标签才移动窗口（selectTab 里维护）。
  const [dualAnchor, setDualAnchor] = useState(0);
  const clampedAnchor = Math.max(0, Math.min(dualAnchor, pages.length - 2));
  const pairIndices =
    dual && pages.length > 1
      ? [clampedAnchor, clampedAnchor + 1]
      : [activeIndex];

  // 双列露出的两层要立即挂载（不是滑过去才加载），不然右边一直转圈。
  useEffect(() => {
    if (!dual) return;
    setVisited((prev) => {
      let next: Set<number> | null = null;
      for (const i of pairIndices) {
        if (!prev.has(i)) {
          if (!next) next = new Set(prev);
          next.add(i);
        }
      }
      return next ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dual, pairIndices.join(",")]);

  const c = readerColors(settings.theme === "dark");

  // <cite> 跳转：切到义注/复注对应层、定位到该段，并高亮目标句（data-sid）。
  const [highlightSid, setHighlightSid] = useState<string | null>(null);

  // 公共：把目标层定位到该段并标记高亮；返回目标层下标（找不到返回 -1）。
  const locateAndHighlight = useCallback(
    (book: number, para: number, start: number, end: number): number => {
      const idx = pages.findIndex((p) => p.book === book);
      if (idx < 0) return -1;
      setPages((prev) => {
        const cur = prev[idx];
        if (!cur || cur.paragraph === para) return prev;
        const next = [...prev];
        next[idx] = { ...cur, paragraph: para };
        return next;
      });
      setVisited((prev) => (prev.has(idx) ? prev : new Set(prev).add(idx)));
      setHighlightSid(`${book}-${para}-${start}-${end}`);
      return idx;
    },
    [pages],
  );

  const handleAnnoJump = useCallback(
    (book: number, para: number, start: number, end: number) => {
      const idx = locateAndHighlight(book, para, start, end);
      if (idx < 0) return;
      setActiveIndex(idx);
      setDualAnchor((anchor) => {
        if (idx >= anchor && idx <= anchor + 1) return anchor;
        return idx < anchor ? idx : idx - 1;
      });
      pagerRef.current?.setPageWithoutAnimation(idx);
    },
    [locateAndHighlight],
  );

  const handleCrossHighlight = useCallback(
    (book: number, para: number, start: number, end: number) => {
      // 平板双栏：只定位 + 高亮另一栏，不切换当前层。
      locateAndHighlight(book, para, start, end);
    },
    [locateAndHighlight],
  );


  const handleChapterAnchor = useCallback(
    (index: number, b: number, para: number, toc: string | null) => {
      if (index !== selfIndexRef.current) {
        // 别的层自己翻章：只刷新标签标题，不影响当前层与另一层。
        setPages((prev) => {
          const cur = prev[index];
          if (
            !cur ||
            (cur.book === b && cur.paragraph === para && cur.toc === toc)
          )
            return prev;
          const next = [...prev];
          next[index] = { ...cur, book: b, paragraph: para, toc };
          return next;
        });
        return;
      }

      const prevAnchor = selfAnchorRef.current;
      const changed =
        !prevAnchor || prevAnchor.book !== b || prevAnchor.paragraph !== para;
      selfAnchorRef.current = { book: b, paragraph: para };

      if (!changed) {
        setPages((prev) => {
          const cur = prev[selfIndexRef.current];
          if (!cur || cur.toc === toc) return prev;
          const next = [...prev];
          next[selfIndexRef.current] = { ...cur, toc };
          return next;
        });
        return;
      }

      // 当前层真的换章了。
      const selfLayer = bookLayerAt(b, para) ?? "mula";
      const prevLayer = pages[selfIndexRef.current]?.layer;
      console.log(
        `[anchor] index=${index} selfIdx=${selfIndexRef.current} b=${b} para=${para} toc="${toc}" selfLayer=${selfLayer} prevLayer=${prevLayer} pagesLen=${pages.length}`,
      );

      if (selfLayer !== prevLayer) {
        // 层变了（跳进义注/复注或另一本书）：收成单层、跳回它，再重新算各层。
        setPages([
          {
            layer: selfLayer,
            book: b,
            paragraph: para,
            title: bookTitleOf(b, para),
            toc,
          },
        ]);
        selfIndexRef.current = 0;
        setVisited(new Set([0]));
        setActiveIndex(0);
        setDualAnchor(0);
        pagerRef.current?.setPageWithoutAnimation(0);

        getChapterLayers(b, para).then(({ chapters, selfIndex }) => {
          // 期间用户又翻了别的章节，这次查询已经过期，丢弃。
          if (
            selfAnchorRef.current?.book !== b ||
            selfAnchorRef.current?.paragraph !== para
          )
            return;
          if (chapters.length === 0) return;
          setPages(
            chapters.map((ch, i) =>
              i === selfIndex
                ? {
                    layer: ch.layer,
                    book: b,
                    paragraph: para,
                    title: bookTitleOf(b, para),
                    toc,
                  }
                : {
                    layer: ch.layer,
                    book: ch.book,
                    paragraph: ch.paragraph,
                    title: bookTitleOf(ch.book, ch.paragraph),
                    toc: ch.toc,
                  },
            ),
          );
          selfIndexRef.current = selfIndex;
          setVisited(new Set([selfIndex]));
          setActiveIndex(selfIndex);
          setDualAnchor(Math.max(0, Math.min(selfIndex, chapters.length - 2)));
          pagerRef.current?.setPageWithoutAnimation(selfIndex);
        });
        return;
      }

      // 同一层连续滚动跨章：不 collapse、不重置 visited/activeIndex/pager，
      // 只原地刷新各层坐标与标题，避免标签栏「原文 ↔ 原文/义注/复注」来回闪。
      getChapterLayers(b, para).then(({ chapters, selfIndex }) => {
        if (
          selfAnchorRef.current?.book !== b ||
          selfAnchorRef.current?.paragraph !== para
        )
          return;
        if (chapters.length === 0) return;
        setPages((prev) =>
          chapters.map((ch, i) => {
            const existing = prev.find((p) => p.layer === ch.layer);
            return i === selfIndex
              ? {
                  ...(existing ?? { layer: ch.layer }),
                  layer: ch.layer,
                  book: b,
                  paragraph: para,
                  title: bookTitleOf(b, para),
                  toc,
                }
              : {
                  ...(existing ?? { layer: ch.layer }),
                  layer: ch.layer,
                  book: ch.book,
                  paragraph: ch.paragraph,
                  title: bookTitleOf(ch.book, ch.paragraph),
                  toc: ch.toc,
                };
          }),
        );
        selfIndexRef.current = selfIndex;
      });
    },
    [],
  );

  const onPageSelected = (e: PagerViewOnPageSelectedEvent) => {
    const idx = e.nativeEvent.position;
    setActiveIndex(idx);
    setVisited((prev) => (prev.has(idx) ? prev : new Set(prev).add(idx)));
  };

  const selectTab = (index: number) => {
    if (index === activeIndex) return;
    if (dual) {
      // 窗口外的标签才挪窗口：点右边的就把窗口右移到刚好包住它，点左边的
      // 同理左移；已经在窗口里的标签只是换高亮，两栏不动。
      setActiveIndex(index);
      setDualAnchor((anchor) => {
        if (index >= anchor && index <= anchor + 1) return anchor;
        return index < anchor ? index : index - 1;
      });
      return;
    }
    if (Math.abs(index - activeIndex) > 1) return;
    pagerRef.current?.setPage(index);
  };

  /**
   * 左右滑动换层 —— **上下滑动优先**。
   *
   * 原来直接用 PagerView 自带的横滑：ViewPager2 只看横向位移够不够 touch slop，
   * 不比较纵向，于是竖着划正文时手指带一点横向抖动就被判成翻页，正文停住不动，
   * 手指继续上滑也没用（那一串事件已经被翻页手势吃掉了）。
   *
   * 现在把翻页关掉，自己用 Pan 判：纵向先走出 `failOffsetY` 就直接判负，
   * 事件原样留给正文滚动；横向走够 `activeOffsetX` 才接管，松手时还要求
   * 横向位移明显压过纵向（1.5 倍）才真的换层。
   */
  const swipeLayer = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-12, 12])
        .onEnd((e) => {
          const { translationX: dx, translationY: dy } = e;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          // 只能去相邻的那一层（原文不能直接跳复注）。
          const next = activeIndex + (dx < 0 ? 1 : -1);
          if (next < 0 || next >= pagesLenRef.current) return;
          pagerRef.current?.setPage(next);
        })
        .runOnJS(true),
    [activeIndex],
  );

  const active = pages[activeIndex];
  const headerTitle = active?.toc ?? active?.title ?? title;

  // 诊断：顶部标题 / 层标签变化时打点，观察是否来回跳。
  useEffect(() => {
    console.log(
      `[title] header="${headerTitle}" activeIndex=${activeIndex} pagesLen=${pages.length} layers=[${pages
        .map((p) => p.layer)
        .join(",")}]`,
    );
  }, [headerTitle, activeIndex, pages]);

  const renderPane = (i: number) => {
    const p = pages[i];
    if (!visited.has(i)) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={c.vermilion} />
        </View>
      );
    }
    return (
      <ReaderLayerPane
        book={p.book}
        paragraph={p.paragraph}
        title={p.title}
        initialToc={p.toc}
        initialChannelId={i === selfIndexRef.current ? channelId : undefined}
        initialChannelName={
          i === selfIndexRef.current ? channelName : undefined
        }
        preferredChannelUid={preferredChannelRef.current.uid}
        preferredChannelName={preferredChannelRef.current.name}
        onChannelChange={handleChannelChange}
        settings={settings}
        onChapterAnchor={(b, para, toc) => handleChapterAnchor(i, b, para, toc)}
        onAnnoJump={handleAnnoJump}
        onCrossHighlight={handleCrossHighlight}
        highlightSid={
          highlightSid && p.book === Number(highlightSid.split("-")[0])
            ? highlightSid
            : null
        }
        navigation={navigation}
      />
    );
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: c.paper }]}
      edges={["top", "left", "right"]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: c.paperRaised, borderBottomColor: c.hairline },
        ]}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={c.ink} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text
            style={[styles.headerTitle, { color: c.ink }]}
            numberOfLines={1}
          >
            {headerTitle}
          </Text>
          {/* 原文 / 义注 / 复注：告诉用户当前在哪一层，点了换到相邻层（不能跳着换）。 */}
          <View style={styles.layerTabs}>
            {pages.map((p, i) => {
              const isActive = i === activeIndex;
              const reachable = dual || Math.abs(i - activeIndex) <= 1;
              return (
                <Pressable
                  key={`${p.layer}-${p.book}`}
                  disabled={!reachable}
                  onPress={() => selectTab(i)}
                  style={[
                    styles.layerTab,
                    isActive && { borderBottomColor: c.vermilion },
                  ]}
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.layerTabText,
                      {
                        color: isActive
                          ? c.vermilion
                          : reachable
                            ? c.inkSoft
                            : c.inkFaint,
                      },
                      isActive && styles.layerTabTextActive,
                    ]}
                  >
                    {t(`layer.${p.layer}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {/* 阅读设置（字号/主题/离线下载）是全局的，不属于某一层，放标题栏共享一份。 */}
        <Pressable onPress={() => setSettingsVisible(true)} hitSlop={8}>
          <Ionicons name="settings-outline" size={22} color={c.ink} />
        </Pressable>
      </View>

      <View
        style={styles.pager}
        onLayout={(e) => setBodyWidth(Math.round(e.nativeEvent.layout.width))}
      >
        {dual ? (
          <View style={styles.dualRow}>
            {pairIndices.map((i, slot) => (
              <View
                key={`${pages[i].layer}-${pages[i].book}`}
                style={[
                  styles.dualPane,
                  slot === 1 && {
                    borderLeftWidth: StyleSheet.hairlineWidth,
                    borderLeftColor: c.hairline,
                  },
                ]}
              >
                {renderPane(i)}
              </View>
            ))}
          </View>
        ) : (
          <GestureDetector gesture={swipeLayer}>
            {/* 翻页交给上面这个 Pan：PagerView 自带的横滑是「谁先动谁赢」，
                竖着划正文时手指稍微带一点横向位移就被判成翻页，正文当场卡住。 */}
            <PagerView
              ref={pagerRef}
              style={styles.pager}
              initialPage={activeIndex}
              scrollEnabled={false}
              onPageSelected={onPageSelected}
            >
              {pages.map((p, i) => (
                <View
                  key={`${p.layer}-${p.book}`}
                  style={styles.pagerPage}
                  collapsable={false}
                >
                  {renderPane(i)}
                </View>
              ))}
            </PagerView>
          </GestureDetector>
        )}
      </View>

      <SettingsSheet
        visible={settingsVisible}
        settings={settings}
        c={c}
        onClose={() => setSettingsVisible(false)}
        onChange={handleChangeSettings}
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
          {t("reader.settings")}
        </Text>

        <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
          {t("reader.fontSize")}
        </Text>
        <FontScale
          value={settings.fontSize}
          c={c}
          onChange={(fontSize) => onChange({ ...settings, fontSize })}
        />

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
            const activeOpt = settings.theme === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[
                  styles.fontPill,
                  { backgroundColor: activeOpt ? c.vermilion : c.paperSunken },
                ]}
                onPress={() => onChange({ ...settings, theme: opt.id })}
              >
                <Text style={{ color: activeOpt ? "#fdfaf1" : c.ink }}>
                  {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
          {t("reader.paliScript")}
        </Text>
        <PaliScriptPicker
          value={settings.paliScript}
          c={c}
          onChange={(paliScript) => onChange({ ...settings, paliScript })}
        />

        <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
          {t("reader.annoCollapsedLines")}
        </Text>
        <View style={styles.fontRow}>
          {[1, 2, 3, 5].map((n) => {
            const active = settings.annotationCollapsedLines === n;
            return (
              <Pressable
                key={n}
                style={[
                  styles.fontPill,
                  { backgroundColor: active ? c.vermilion : c.paperSunken },
                ]}
                onPress={() =>
                  onChange({ ...settings, annotationCollapsedLines: n })
                }
              >
                <Text style={{ color: active ? "#fdfaf1" : c.ink }}>{n}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sheetSection, { color: c.inkSoft }]}>
          {t("reader.annoMode")}
        </Text>
        <View style={styles.fontRow}>
          {(
            [
              { id: "inline", labelKey: "reader.annoMode.inline" },
              { id: "footnote", labelKey: "reader.annoMode.footnote" },
            ] as const
          ).map((opt) => {
            const active = settings.annotationMode === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[
                  styles.fontPill,
                  { backgroundColor: active ? c.vermilion : c.paperSunken },
                ]}
                onPress={() =>
                  onChange({ ...settings, annotationMode: opt.id })
                }
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

/**
 * 巴利字体选择。
 *
 * 「跟随语言」排在最前面且是默认值 —— 斯里兰卡 / 缅甸 / 泰国的界面语言各自
 * 对应本国文字，其余语言用罗马巴利（见 `src/pali/script/preference.ts`）；
 * 它的胶囊上直接标出当前会落到哪种字体，免得用户要试一下才知道。
 */
function PaliScriptPicker({
  value,
  c,
  onChange,
}: {
  value: PaliScriptPreference;
  c: ReaderChrome;
  onChange: (v: PaliScriptPreference) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const auto = resolvePaliScript("auto", locale);

  const options: { id: PaliScriptPreference; label: string }[] = [
    { id: "auto", label: `${t("script.auto")} · ${TARGET_LABELS[auto].name}` },
    ...TARGET_SCRIPTS.map((id) => {
      const l = TARGET_LABELS[id];
      return {
        id: id as PaliScriptPreference,
        label: l.noteKey ? `${l.name}（${t(l.noteKey)}）` : l.name,
      };
    }),
  ];

  return (
    <View style={styles.fontRow}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <Pressable
            key={opt.id}
            style={[
              styles.fontPill,
              { backgroundColor: active ? c.vermilion : c.paperSunken },
            ]}
            onPress={() => onChange(opt.id)}
          >
            <Text style={{ color: active ? "#fdfaf1" : c.ink }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 字号选择：四节点进度条。左右两端用「小 / 大」标注，档位本身不写字
 * —— 四个档的名字（标准/特大之类）在这么窄的条上只会互相挤。
 *
 * 整条都可点，也可以按住拖动，落点取最近的节点。
 */
function FontScale({
  value,
  c,
  onChange,
}: {
  value: ReaderSettings["fontSize"];
  c: ReaderChrome;
  onChange: (v: ReaderSettings["fontSize"]) => void;
}) {
  const last = FONT_OPTIONS.length - 1;
  const index = Math.max(
    0,
    FONT_OPTIONS.findIndex((f) => f.id === value),
  );

  // PanResponder 只创建一次，靠 ref 读最新的宽度与选中值，避免闭包读到旧状态。
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pick = useCallback(
    (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const i = Math.round(Math.min(1, Math.max(0, x / w)) * last);
      const next = FONT_OPTIONS[i];
      if (next && next.id !== valueRef.current) {
        onChangeRef.current(next.id as ReaderSettings["fontSize"]);
      }
    },
    [last],
  );

  // 拖动只能用绝对坐标：move 事件里的 locationX 在 Android 上不可靠
  // （实测一路右拖反而跳到最左档）。按下时用 pageX - locationX 得到轨道
  // 自身的屏幕左边界，之后统一拿 gestureState.moveX 减掉它。
  const originRef = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        originRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        pick(e.nativeEvent.locationX);
      },
      onPanResponderMove: (_e, g) => pick(g.moveX - originRef.current),
    }),
  ).current;

  return (
    <View style={styles.scaleRow}>
      <Text style={[styles.scaleCap, { color: c.inkSoft, fontSize: 12 }]}>
        小
      </Text>

      <View style={styles.scaleTrackHit} {...pan.panHandlers}>
        <View
          style={styles.scaleTrackInner}
          onLayout={(e) => {
            widthRef.current = e.nativeEvent.layout.width;
          }}
        >
          <View style={[styles.scaleLine, { backgroundColor: c.border }]} />
          <View
            style={[
              styles.scaleLineFill,
              {
                backgroundColor: c.vermilion,
                width: `${(index / last) * 100}%`,
              },
            ]}
          />
          {FONT_OPTIONS.map((f, i) => (
            <View
              key={f.id}
              style={[
                styles.scaleDot,
                {
                  left: `${(i / last) * 100}%`,
                  backgroundColor: i <= index ? c.vermilion : c.paperSunken,
                  borderColor: i <= index ? c.vermilion : c.border,
                },
                i === index && styles.scaleDotActive,
              ]}
            />
          ))}
        </View>
      </View>

      <Text style={[styles.scaleCap, { color: c.inkSoft, fontSize: 19 }]}>
        大
      </Text>
    </View>
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
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  layerTabs: {
    flexDirection: "row",
    gap: 16,
    marginTop: 2,
  },
  layerTab: {
    paddingVertical: 2,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  layerTabText: {
    fontSize: 12,
  },
  layerTabTextActive: {
    fontWeight: "700",
  },
  pager: {
    flex: 1,
  },
  pagerPage: {
    flex: 1,
  },
  dualRow: {
    flex: 1,
    flexDirection: "row",
  },
  dualPane: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  scaleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  scaleCap: {
    width: 24,
    textAlign: "center",
  },
  // 触摸区比线粗得多，免得要"戳准"那根 3px 的线
  scaleTrackHit: {
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  scaleTrackInner: {
    height: 18,
    marginHorizontal: 9,
    justifyContent: "center",
  },
  scaleLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
  },
  // 单独写一份：RN 的样式合并会忽略 undefined，靠覆盖 scaleLine 的 right 清不掉
  scaleLineFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 2,
  },
  scaleDot: {
    position: "absolute",
    top: 3,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    borderWidth: 1,
  },
  scaleDotActive: {
    top: 0,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
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
});
