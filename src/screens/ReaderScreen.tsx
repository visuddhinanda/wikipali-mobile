import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import Checkbox from "expo-checkbox";
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
import {
  NavBtn,
  ReaderLayerPane,
  type ReaderLayerPaneHandle,
} from "./ReaderLayerPane";
import { DownloadIconButton } from "../components/DownloadIconButton";
import { KeepAwake } from "../components/KeepAwake";
import { serifFont } from "../theme";
import { useLayout } from "../hooks/useLayout";
import {
  READER_BACKGROUND_PAPER,
  readerColorsFor,
  type ReaderBackground,
  type ReaderChrome,
} from "../theme/reader";
import { useI18n, useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
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
  type ReaderLineHeight,
  type ReaderPageMargin,
  type ReaderSettings,
} from "../settings/reader";
import * as Brightness from "expo-brightness";
import type { RootStackParamList } from "../navigation/types";
import { resolveBaseUrl } from "../api/config";
import { buildWikipaliUrl, webOriginFromBaseUrl } from "../linking/wikipali-url";

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

  // 应用亮度设置：跟随系统 → 恢复系统亮度；手动 → 设置当前 Activity 亮度。
  useEffect(() => {
    const apply = async () => {
      try {
        if (settings.brightnessMode === "system") {
          await Brightness.restoreSystemBrightnessAsync();
        } else {
          await Brightness.setBrightnessAsync(settings.brightness);
        }
      } catch {
        // 亮度 API 不可用时静默忽略（模拟器 / 无传感器设备）。
      }
    };
    void apply();
  }, [settings.brightnessMode, settings.brightness]);

  // 离开阅读器时恢复系统亮度，避免把亮度带出阅读页。
  useEffect(() => {
    return () => {
      void Brightness.restoreSystemBrightnessAsync().catch(() => {});
    };
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
  // 同层跨章时相关层集合变了、self 层下标随之移动（复注层常见），需要在 commit
  // 之后把 PagerView 无动画挪到新下标，见下面的 useLayoutEffect 与 lighter path。
  const pendingPagerSyncRef = useRef(false);
  // 驱动重算的是「用户所在的那一层」，不再固定是第 0 页。
  const selfIndexRef = useRef(0);
  // 手势回调里读页数：Pan 只随 activeIndex 重建，闭包里的 pages 会过期。
  const pagesLenRef = useRef(1);
  pagesLenRef.current = pages.length;
  // handleChapterAnchor 是 useCallback([]) 的稳定闭包，读到的 `pages` 永远是挂载时的
  // 旧数组（长度 1），导致 `pages[selfIndexRef.current]` 取 undefined、把同层跨章误判成
  // 「层变了」而 collapse。这里用 ref 始终指向最新 pages。
  const pagesRef = useRef<PageMeta[]>(pages);
  pagesRef.current = pages;
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
  // 每一层当前选的版本（uid/name）：标题栏的「下载」按钮只针对当前层，
  // 需要知道这一层现在用哪个版本。由各层上报，这里按下标记一份。
  const [layerChannels, setLayerChannels] = useState<
    Record<number, { uid?: string; name?: string }>
  >({});
  const handleChannelChange = useCallback(
    (index: number, uid: string | undefined, name: string | undefined) => {
      if (uid) preferredChannelRef.current = { uid, name };
      setLayerChannels((prev) => {
        const cur = prev[index];
        if (cur?.uid === uid && cur?.name === name) return prev;
        return { ...prev, [index]: { uid, name } };
      });
    },
    [],
  );

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);

  // 底部工具栏只渲染一份，作用于焦点栏（activeIndex）。每个 pane 通过 ref
  // 暴露 goPrev/goNext/openToc/openVersion/openMore，工具栏据此调用焦点栏。
  const paneRefs = useRef<Record<number, ReaderLayerPaneHandle | null>>({});
  // 每栏上报的「上一章/下一章」可用性，工具栏显示焦点栏的这份值。
  const [navStates, setNavStates] = useState<
    Record<number, { hasPrev: boolean; hasNext: boolean }>
  >({});
  const handleNavState = useCallback(
    (index: number, hasPrev: boolean, hasNext: boolean) => {
      setNavStates((prev) => {
        const cur = prev[index];
        if (cur?.hasPrev === hasPrev && cur?.hasNext === hasNext) return prev;
        return { ...prev, [index]: { hasPrev, hasNext } };
      });
    },
    [],
  );

  // App 转后台 / 被系统清退前，把焦点栏的视口顶部段落盘到阅读记录，
  // 保证「恢复上次阅读位置」拿到的是刚离开那一刻的位置（见 useRestoreLastReading）。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        paneRefs.current[selfIndexRef.current]?.savePosition();
      }
    });
    return () => sub.remove();
  }, []);

  // 双列对照：阅读区净宽（onLayout 实测）达到 canDualColumn 的阈值就并排
  // 显示两层，否则退回单层 + 滑动（docs/README.md §4.7）。
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

  const c = readerColorsFor(settings.background);

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
      const prevLayer = pagesRef.current[selfIndexRef.current]?.layer;

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
        const prevSelfIndex = selfIndexRef.current;
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
        // 相关层集合变了（如 [mula,atthakatha,tika] ↔ [atthakatha,tika] ↔ [tika]），
        // self 层下标随之移动：同步 activeIndex，并把新下标标为已挂载（否则增长场景
        // 会看到 spinner），最后在 useLayoutEffect 里把 PagerView 无动画挪过去 ——
        // 否则 PagerView 停在旧下标（已变成别的层或越界），跨章时从右侧重拉当前页。
        if (selfIndex !== prevSelfIndex) {
          setActiveIndex(selfIndex);
          setVisited((prev) =>
            prev.has(selfIndex) ? prev : new Set(prev).add(selfIndex),
          );
          pendingPagerSyncRef.current = true;
        }
      });
    },
    [],
  );

  // 同层跨章导致 self 层下标移动时，等 pages/activeIndex 提交到 PagerView 之后
  // 再无动画同步到新下标。不能同步调用：那时 PagerView 还是旧 children，增长场景
  // （如 [tika] → [mula,atthakatha,tika]）会越界、落在别的层上。
  useLayoutEffect(() => {
    if (!pendingPagerSyncRef.current) return;
    pendingPagerSyncRef.current = false;
    pagerRef.current?.setPageWithoutAnimation(activeIndex);
  }, [pages, activeIndex]);

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
  const activeChannel = layerChannels[activeIndex];
  // 底部工具栏显示焦点栏的翻章可用性（未加载的栏默认都禁用）。
  const nav = navStates[activeIndex] ?? { hasPrev: false, hasNext: false };

  // 分享当前章节：生成一条 WikiPali 网页链接，直接打开系统分享抽屉
  // （其中自带「复制」）。定位取「用户自己这一层」当前章节锚点，
  // 刚进还没报锚点时退回路由参数。
  const shareCurrent = useCallback(async () => {
    const pos = selfAnchorRef.current ?? { book, paragraph };
    const para = pos.paragraph ?? paragraph;
    if (para == null) return;
    const base = await resolveBaseUrl();
    const url = buildWikipaliUrl(webOriginFromBaseUrl(base), {
      kind: "reader",
      book: pos.book,
      paragraph: para,
      channelId: preferredChannelRef.current.uid,
    });
    try {
      await Share.share({ title: headerTitle, message: url });
    } catch {
      // 用户取消分享会 reject，忽略即可。
    }
  }, [book, paragraph, headerTitle]);

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
        ref={(node) => {
          if (node) paneRefs.current[i] = node;
          else delete paneRefs.current[i];
        }}
        book={p.book}
        paragraph={p.paragraph}
        title={p.title}
        initialToc={p.toc}
        // 只有用户正在读的那一层可以「首屏没内容就挪到有内容处」，
        // 义注/复注层要跟原文层的章节对齐，不能自己跑掉。
        seekContent={i === selfIndexRef.current}
        initialChannelId={i === selfIndexRef.current ? channelId : undefined}
        initialChannelName={
          i === selfIndexRef.current ? channelName : undefined
        }
        preferredChannelUid={preferredChannelRef.current.uid}
        preferredChannelName={preferredChannelRef.current.name}
        onChannelChange={(uid, name) => handleChannelChange(i, uid, name)}
        onFocus={() => setActiveIndex(i)}
        onNavState={(hasPrev, hasNext) => handleNavState(i, hasPrev, hasNext)}
        onShare={() => void shareCurrent()}
        settings={settings}
        onChapterAnchor={(b, para, toc) => handleChapterAnchor(i, b, para, toc)}
        onAnnoJump={handleAnnoJump}
        onCrossHighlight={handleCrossHighlight}
        // 双栏时只有左栏是「点注释 → 跨栏高亮、不展开」的起点；右栏保持原互动。
        dualOrigin={pairIndices.length === 2 && i === pairIndices[0]}
        highlightSid={
          highlightSid && p.book === Number(highlightSid.split("-")[0])
            ? highlightSid
            : null
        }
        focused={i === activeIndex}
        navigation={navigation}
      />
    );
  };

  // 底部工具栏的六个按钮：手机窄屏分两行（上一行翻章、下一行工具），
  // 双列宽屏合并为一行（见下方 return 里的 dual 分支）。
  const tb = {
    prev: (
      <NavBtn
        icon="chevron-back"
        label={t("reader.prevChapter")}
        disabled={!nav.hasPrev}
        c={c}
        onPress={() => paneRefs.current[activeIndex]?.goPrev()}
      />
    ),
    next: (
      <NavBtn
        icon="chevron-forward"
        label={t("reader.nextChapter")}
        iconPosition="right"
        disabled={!nav.hasNext}
        c={c}
        onPress={() => paneRefs.current[activeIndex]?.goNext()}
      />
    ),
    toc: (
      <NavBtn
        icon="list-outline"
        label={t("reader.toc")}
        c={c}
        onPress={() => paneRefs.current[activeIndex]?.openToc()}
      />
    ),
    version: (
      <NavBtn
        icon="layers-outline"
        label={t("reader.version")}
        c={c}
        onPress={() => paneRefs.current[activeIndex]?.openVersion()}
      />
    ),
    settings: (
      <NavBtn
        icon="settings-outline"
        label={t("reader.settings")}
        c={c}
        onPress={() => setSettingsVisible(true)}
      />
    ),
    more: (
      <NavBtn
        icon="ellipsis-horizontal"
        label={t("reader.more")}
        c={c}
        onPress={() => paneRefs.current[activeIndex]?.openMore()}
      />
    ),
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: c.paper }]}
      // App 导航栏在阅读器里隐藏，底部需要自己避让系统手势条 / Home 指示器。
      edges={["top", "left", "right", "bottom"]}
    >
      {settings.keepAwake && <KeepAwake />}
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
        {/* 离线下载：原「设置」图标已移到底部导航，这里换成针对当前层的下载。
            分享已从顶部栏去掉（「更多」菜单里有）。 */}
        {active && activeChannel?.uid ? (
          <DownloadIconButton
            book={active.book}
            channelId={activeChannel.uid}
            color={c.ink}
            size={22}
            paragraph={paragraph}
          />
        ) : (
          <Ionicons name="cloud-download-outline" size={22} color={c.inkFaint} />
        )}
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
                {/* 焦点内框线：覆盖在焦点栏上，不改变 WebView 布局。 */}
                {i === activeIndex && (
                  <View
                    pointerEvents="none"
                    style={[styles.focusRing, { borderColor: c.vermilion }]}
                  />
                )}
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

      {/* 底部工具栏（全屏唯一一份）：作用于焦点栏（activeIndex）。
          手机窄屏分两行；双列宽屏合并为一行。 */}
      <View
        style={[
          styles.toolbar,
          { backgroundColor: c.paperRaised, borderTopColor: c.hairline },
        ]}
      >
        {dual ? (
          <View style={styles.toolbarRow}>
            {tb.prev}
            {tb.next}
            {tb.toc}
            {tb.version}
            {tb.settings}
            {tb.more}
          </View>
        ) : (
          <>
            <View style={styles.toolbarRow}>
              {tb.prev}
              {tb.next}
            </View>
            <View style={styles.toolbarRow}>
              {tb.toc}
              {tb.version}
              {tb.settings}
              {tb.more}
            </View>
          </>
        )}
      </View>

      <SettingsSheet
        visible={settingsVisible}
        settings={settings}
        c={c}
        onClose={() => setSettingsVisible(false)}
        onChange={handleChangeSettings}
        onMore={() => {
          setSettingsVisible(false);
          setMoreVisible(true);
        }}
      />

      <MoreSettingsSheet
        visible={moreVisible}
        settings={settings}
        c={c}
        onClose={() => setMoreVisible(false)}
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
  onMore,
}: {
  visible: boolean;
  settings: ReaderSettings;
  c: ReaderChrome;
  onClose: () => void;
  onChange: (s: ReaderSettings) => void;
  onMore: () => void;
}) {
  const t = useT();
  const fontIndex = Math.max(
    0,
    FONT_OPTIONS.findIndex((f) => f.id === settings.fontSize),
  );
  const fontPx = FONT_OPTIONS[fontIndex]?.px ?? 15;
  const setFontIndex = (i: number) => {
    const next = FONT_OPTIONS[Math.max(0, Math.min(FONT_OPTIONS.length - 1, i))];
    if (next) onChange({ ...settings, fontSize: next.id });
  };
  const followSystem = settings.brightnessMode === "system";

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
        <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />
        <Text
          style={[styles.sheetTitle, { color: c.ink, fontFamily: serifFont }]}
        >
          {t("reader.settings")}
        </Text>

        {/* 亮度：原生滑杆 + 跟随系统勾选（拖动滑杆自动取消勾选） */}
        <View style={styles.qrow}>
          <Text style={[styles.qlabel, { color: c.ink }]}>
            {t("reader.brightness")}
          </Text>
          <Slider
            style={styles.brightnessSlider}
            minimumValue={0.3}
            maximumValue={1}
            value={settings.brightness}
            onValueChange={(brightness) =>
              onChange({ ...settings, brightness, brightnessMode: "app" })
            }
            minimumTrackTintColor={followSystem ? c.inkFaint : c.vermilion}
            maximumTrackTintColor={c.border}
            thumbTintColor={followSystem ? c.inkFaint : c.vermilion}
          />
          <View style={styles.followBtn}>
            <Checkbox
              value={followSystem}
              onValueChange={(v) =>
                onChange({
                  ...settings,
                  brightnessMode: v ? "system" : "app",
                })
              }
              color={c.vermilion}
            />
            <Text
              style={[
                styles.followLabel,
                { color: followSystem ? c.ink : c.inkSoft },
              ]}
            >
              {t("reader.brightness.followSystem")}
            </Text>
          </View>
        </View>

        {/* 字号：A− / 当前值 / A+ */}
        <View style={styles.qrow}>
          <Text style={[styles.qlabel, { color: c.ink }]}>
            {t("reader.fontSize")}
          </Text>
          <View style={styles.qc}>
            <Pressable
              style={[
                styles.stepBtn,
                { borderColor: c.border, backgroundColor: c.paper },
              ]}
              disabled={fontIndex === 0}
              hitSlop={6}
              onPress={() => setFontIndex(fontIndex - 1)}
            >
              <Text
                style={[
                  styles.stepBtnText,
                  { color: fontIndex === 0 ? c.inkFaint : c.ink },
                ]}
              >
                A−
              </Text>
            </Pressable>
            <Text style={[styles.fontValue, { color: c.ink }]}>{fontPx}</Text>
            <Pressable
              style={[
                styles.stepBtn,
                { borderColor: c.border, backgroundColor: c.paper },
              ]}
              disabled={fontIndex === FONT_OPTIONS.length - 1}
              hitSlop={6}
              onPress={() => setFontIndex(fontIndex + 1)}
            >
              <Text
                style={[
                  styles.stepBtnText,
                  {
                    color:
                      fontIndex === FONT_OPTIONS.length - 1
                        ? c.inkFaint
                        : c.ink,
                  },
                ]}
              >
                A+
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 背景：只色块，无文字 */}
        <View style={styles.qrow}>
          <Text style={[styles.qlabel, { color: c.ink }]}>
            {t("reader.background")}
          </Text>
          <View style={styles.qc}>
            {(Object.keys(READER_BACKGROUND_PAPER) as ReaderBackground[]).map(
              (key) => {
                const active = settings.background === key;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: READER_BACKGROUND_PAPER[key],
                        borderColor: active ? c.vermilion : c.border,
                      },
                    ]}
                    onPress={() => onChange({ ...settings, background: key })}
                  >
                    {active && (
                      <Ionicons
                        name="checkmark"
                        size={16}
                        color={key === "dark" ? "#e8dfd0" : "#8c3b2e"}
                      />
                    )}
                  </Pressable>
                );
              },
            )}
          </View>
        </View>

        {/* 注释：行内 / 段后 */}
        <View style={styles.qrow}>
          <Text style={[styles.qlabel, { color: c.ink }]}>
            {t("reader.annoMode")}
          </Text>
          <View style={styles.qc}>
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
                    {
                      backgroundColor: active ? c.vermilion : c.paperSunken,
                    },
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

        {/* 更多设置 */}
        <Pressable style={styles.qrow} onPress={onMore}>
          <Text style={[styles.qlabel, { color: c.ink }]}>
            {t("reader.moreSettings")}
          </Text>
          <View style={styles.qcEnd}>
            <Ionicons name="chevron-forward" size={18} color={c.inkFaint} />
          </View>
        </Pressable>
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
 * 更多设置：完整页面（push 式滑入），收纳低频项。返回即回到阅读页。
 */
function MoreSettingsSheet({
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
  const inline = settings.annotationMode === "inline";

  const pillGroup = (
    options: { id: string; labelKey: MessageKey }[],
    activeId: string,
    apply: (id: string) => void,
    disabled = false,
  ) => (
    <View style={[styles.fontRow, disabled && styles.disabledRow]}>
      {options.map((opt) => {
        const active = activeId === opt.id;
        return (
          <Pressable
            key={opt.id}
            disabled={disabled}
            style={[
              styles.fontPill,
              { backgroundColor: active ? c.vermilion : c.paperSunken },
            ]}
            onPress={() => apply(opt.id)}
          >
            <Text style={{ color: active ? "#fdfaf1" : c.ink }}>
              {t(opt.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={[styles.moreSafe, { backgroundColor: c.paper }]}
        edges={["top", "left", "right", "bottom"]}
      >
        <View
          style={[
            styles.moreHead,
            { backgroundColor: c.paperRaised, borderBottomColor: c.hairline },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={c.ink} />
          </Pressable>
          <Text
            style={[styles.moreTitle, { color: c.ink, fontFamily: serifFont }]}
          >
            {t("reader.moreSettings")}
          </Text>
          <View style={styles.moreHeadSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.moreBody}>
          <Text style={[styles.moreLabel, { color: c.inkSoft }]}>
            {t("reader.paliScript")}
          </Text>
          <PaliScriptPicker
            value={settings.paliScript}
            c={c}
            onChange={(paliScript) => onChange({ ...settings, paliScript })}
          />

          <Text style={[styles.moreLabel, { color: c.inkSoft }]}>
            {t("reader.lineHeight")}
          </Text>
          {pillGroup(
            [
              { id: "compact", labelKey: "reader.lineHeight.compact" },
              { id: "standard", labelKey: "reader.lineHeight.standard" },
              { id: "loose", labelKey: "reader.lineHeight.loose" },
            ],
            settings.lineHeight,
            (lineHeight) =>
              onChange({
                ...settings,
                lineHeight: lineHeight as ReaderLineHeight,
              }),
          )}

          <Text style={[styles.moreLabel, { color: c.inkSoft }]}>
            {t("reader.margin")}
          </Text>
          {pillGroup(
            [
              { id: "narrow", labelKey: "reader.margin.narrow" },
              { id: "standard", labelKey: "reader.margin.standard" },
              { id: "wide", labelKey: "reader.margin.wide" },
            ],
            settings.pageMargin,
            (pageMargin) =>
              onChange({
                ...settings,
                pageMargin: pageMargin as ReaderPageMargin,
              }),
          )}

          <Text style={[styles.moreLabel, { color: c.inkSoft }]}>
            {t("reader.annoCollapsedLines")}
            <Text style={{ color: c.inkFaint }}>
              {" "}· {t("reader.annoCollapsedHint")}
            </Text>
          </Text>
          <View style={[styles.fontRow, inline && styles.disabledRow]}>
            {[1, 2, 3, 5].map((n) => {
              const active = settings.annotationCollapsedLines === n;
              return (
                <Pressable
                  key={n}
                  disabled={inline}
                  style={[
                    styles.fontPill,
                    {
                      backgroundColor: active ? c.vermilion : c.paperSunken,
                    },
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

          <View style={styles.moreSwitchRow}>
            <Text style={[styles.moreSwitchLabel, { color: c.ink }]}>
              {t("reader.keepAwake")}
            </Text>
            <Switch
              value={settings.keepAwake}
              onValueChange={(keepAwake) => onChange({ ...settings, keepAwake })}
              trackColor={{ false: c.paperSunken, true: c.vermilion }}
              thumbColor="#fdfaf1"
            />
          </View>

          <View style={styles.moreSwitchRow}>
            <Text style={[styles.moreSwitchLabel, { color: c.ink }]}>
              {t("reader.restoreLastReading")}
            </Text>
            <Switch
              value={settings.restoreLastReading}
              onValueChange={(restoreLastReading) =>
                onChange({ ...settings, restoreLastReading })
              }
              trackColor={{ false: c.paperSunken, true: c.vermilion }}
              thumbColor="#fdfaf1"
            />
          </View>

          <Pressable
            style={[styles.resetBtn, { borderColor: c.border }]}
            onPress={() => onChange({ ...DEFAULT_READER_SETTINGS })}
          >
            <Text style={[styles.resetText, { color: c.vermilion }]}>
              {t("reader.reset")}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
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
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    opacity: 0.5,
  },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarRow: {
    flexDirection: "row",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // 快速面板（底部抽屉）
  sheetBackdrop: {
    flex: 1,
  },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 4,
  },
  qrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
  },
  qlabel: {
    width: 72,
    fontSize: 14,
  },
  qc: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qcEnd: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  followBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  followLabel: {
    fontSize: 13,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  fontValue: {
    minWidth: 24,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  // 亮度滑杆（原生 Slider）
  brightnessSlider: {
    flex: 1,
    height: 40,
  },

  // 胶囊（PaliScriptPicker 与新面板共用）
  fontRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  fontPill: {
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  disabledRow: {
    opacity: 0.4,
  },

  // 更多设置完整页
  moreSafe: {
    flex: 1,
  },
  moreHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moreHeadSpacer: {
    width: 24,
  },
  moreTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  moreBody: {
    padding: 16,
    paddingBottom: 32,
  },
  moreLabel: {
    fontSize: 13,
    marginTop: 16,
    marginBottom: 8,
  },
  moreSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
  },
  moreSwitchLabel: {
    fontSize: 15,
  },
  resetBtn: {
    marginTop: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  resetText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
