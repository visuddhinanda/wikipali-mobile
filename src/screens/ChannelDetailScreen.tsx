/**
 * 译本频道详情：工作室信息 + 该频道下的书列表。
 *
 * 书列表是**服务端列表与本地下载记录的并集** —— 频道内容随时间会变，
 * 已经下过、如今服务端不再列出的书仍要能看到（和删除），否则那份缓存就
 * 成了删不掉的孤儿。已下载的排在最前面。
 *
 * 信息块下方有一道「列表｜分类」工具条：
 * - 列表：现在的书列表，标题栏右上角漏斗按下载状态过滤（全部/已下载/下载中/未下载）。
 * - 分类：复用「分类」栏目的三藏目录树，下钻到叶子后直接显示该频道落在该
 *   分类下的书（按 根本 → 义注 → 复注 排序）。分类视图下隐藏下载漏斗。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Avatar } from "../components/ChannelRow";
import { BookDownloadCard } from "../components/BookDownloadCard";
import { Breadcrumb } from "../components/Breadcrumb";
import { CategoryRow } from "../components/CategoryRow";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  fetchChannel,
  fetchChannelBooks,
  studioLabel,
  type ChannelBook,
  type ChannelInfo,
} from "../api/channels";
import {
  bookEntryAt,
  bookKind,
  bookLayerAt,
  booksUnderTags,
  getTree,
  isLeaf,
  type BookKind,
  type CategoryNode,
} from "../catalog";
import { label } from "../catalog/labels";
import {
  downloadBook,
  isDownloading,
  listDownloads,
  pauseDownload,
  rememberChannelName,
  resolveBookTitles,
  type DownloadProgress,
} from "../reading";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "ChannelDetail">;

/** 过滤项；`all` 之外三档对应下载状态。 */
const FILTERS = ["all", "done", "downloading", "pending"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, MessageKey> = {
  all: "channel.filter.all",
  done: "download.done",
  downloading: "download.downloading",
  pending: "download.notDownloaded",
};

/** 书目分类排序：根本 → 义注 → 复注（与 ChapterListScreen 一致）。 */
const KIND_RANK: Record<BookKind, number> = {
  root: 0,
  atthakatha: 1,
  tika: 2,
};

/** 书列表的两种视图。 */
type ViewMode = "list" | "category";

/** FlatList 的一行：列表/分类叶子里的书，或分类视图里的目录节点。 */
type Row =
  | { key: string; kind: "book"; book: ChannelBook }
  | { key: string; kind: "node"; node: CategoryNode };

/** 下载状态归到哪一档（暂停 / 失败都还没下完，算「未下载」）。 */
function bucket(p?: DownloadProgress): Exclude<Filter, "all"> {
  if (p?.status === "done") return "done";
  if (p?.status === "downloading") return "downloading";
  return "pending";
}

export function ChannelDetailScreen({ route, navigation }: Props) {
  const { uid, name, mode } = route.params;
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const [books, setBooks] = useState<ChannelBook[] | null>(null);
  // 各书的展示名：频道 level=1 译文 > i18n > 服务端 title > 巴利 toc。
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // 本地下载记录（并集的另一半，也用来把已下载的排到前面）。
  const [local, setLocal] = useState<Map<number, DownloadProgress>>(new Map());
  // 各书的实时状态（卡片回报），只用于过滤。
  const [status, setStatus] = useState<Map<number, Filter>>(new Map());
  const [filter, setFilter] = useState<Filter>("all");
  const [menu, setMenu] = useState(false);
  // 「全部下载」的进度（第几本 / 共几本）；null 表示没在批量下载。
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(
    null,
  );
  // 列表｜分类 视图切换。
  const [view, setView] = useState<ViewMode>("list");
  // 分类视图的下钻路径（根 → 当前节点；空数组 = 根层）。叶子也 push 进来，
  // 这样面包屑能显示完整路径，「是否在叶子」由最后一项 `isLeaf` 判定。
  const [catPath, setCatPath] = useState<CategoryNode[]>([]);
  const stopped = useRef(false);

  useEffect(() => {
    let alive = true;
    // 频道名先记进本地 channels 表：书架列表靠它把 uid 显示成人话。
    void rememberChannelName(uid, name);

    listDownloads().then((rows) => {
      if (!alive) return;
      setLocal(
        new Map(rows.filter((r) => r.channel === uid).map((r) => [r.book, r])),
      );
    });
    fetchChannel(uid)
      .then((c) => alive && setInfo(c))
      .catch(() => undefined);
    fetchChannelBooks(uid)
      .then((rows) => alive && setBooks(dedupe(rows)))
      .catch((err) =>
        alive
          ? // 离线时服务端列表拿不到，但本地下载过的书仍要能看到 —— 下面
            // mergeLocal 会把它们补进来，这里只把列表置空而不报错。
            (setBooks([]),
            setError(
              err instanceof Error ? err.message : t("common.loadFailed"),
            ))
          : undefined,
      );
    return () => {
      alive = false;
    };
  }, [uid]);

  // 书名卡片：频道译出的 level=1 标题优先，其次 i18n，最后巴利 toc。
  // 书列表或 UI 语言变化时重算（i18n 是兜底，跟界面语言走）。
  useEffect(() => {
    if (!books) return;
    let alive = true;
    resolveBookTitles(
      locale,
      uid,
      books.map((b) => ({ book: b.book, para: b.para, serverTitle: b.title })),
    ).then((m) => {
      if (alive) setTitles(m);
    });
    return () => {
      alive = false;
    };
  }, [books, locale, uid]);

  // 离开页面就别再往下下一本了 —— 批量下载是用户在这个页面上发起的动作。
  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        stopped.current = true;
      }),
    [navigation],
  );

  // 标题栏右上角的过滤器：只在「列表」视图出现。
  useEffect(() => {
    navigation.setOptions({
      headerRight:
        view === "list"
          ? () => (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setMenu(true)}
                style={styles.headerBtn}
              >
                <Ionicons
                  name={filter === "all" ? "funnel-outline" : "funnel"}
                  size={20}
                  color={filter === "all" ? colors.ink : colors.vermilion}
                />
              </Pressable>
            )
          : undefined,
    });
  }, [navigation, filter, view]);

  /** 服务端列表 ∪ 本地下载记录，已下载的排前面。 */
  const merged = useMemo<ChannelBook[] | null>(() => {
    if (books === null) return null;
    const rows = [...books];
    const known = new Set(rows.map((r) => r.book));
    for (const [book, p] of local) {
      if (!known.has(book) && p.done > 0) {
        rows.push({
          book,
          para: bookEntryAt(book)?.paragraph ?? 0,
          progress: 0,
        });
      }
    }
    const downloaded = (b: ChannelBook) =>
      (status.get(b.book) ?? bucket(local.get(b.book))) === "done" ? 0 : 1;
    return rows.sort(
      (a, b) => downloaded(a) - downloaded(b) || a.book - b.book,
    );
  }, [books, local, status]);

  const visible = useMemo(
    () =>
      merged?.filter(
        (b) =>
          filter === "all" ||
          (status.get(b.book) ?? bucket(local.get(b.book))) === filter,
      ) ?? null,
    [merged, filter, status, local],
  );

  const onProgress = useCallback((p: DownloadProgress) => {
    const next = bucket(p);
    setStatus((prev) =>
      prev.get(p.book) === next ? prev : new Map(prev).set(p.book, next),
    );
  }, []);

  /** 书名：优先已解析的（频道译文 / i18n），没解析完就退回本地书目 toc。 */
  const bookTitle = useCallback(
    (b: ChannelBook): string =>
      titles.get(b.book) ??
      bookEntryAt(b.book, b.para)?.toc ??
      b.title ??
      String(b.book),
    [titles],
  );

  const openBook = useCallback(
    (b: ChannelBook) =>
      navigation.navigate("Reader", {
        book: b.book,
        paragraph: b.para || undefined,
        title: bookTitle(b),
        channelId: uid,
        channelName: name,
      }),
    [navigation, uid, name, bookTitle],
  );

  const downloadAll = async () => {
    if (!merged) return;
    stopped.current = false;
    setBulk({ done: 0, total: merged.length });
    // 逐个下载：一本下完再下一本（下载层串行，这里只是按序发起）。
    for (let i = 0; i < merged.length; i += 1) {
      if (stopped.current) break;
      setBulk({ done: i, total: merged.length });
      try {
        await downloadBook(uid, merged[i].book, undefined, merged[i].para);
      } catch {
        // 单本失败不中断整批：书列表里那一行会显示失败状态。
      }
    }
    setBulk(null);
  };

  const stopAll = () => {
    stopped.current = true;
    const running = merged?.find((b) => isDownloading(uid, b.book));
    if (running) pauseDownload(uid, running.book);
    setBulk(null);
  };

  const studio = studioLabel(info?.studio);
  const readonly = mode !== "download";

  // —— 分类视图 ——
  const catCurrent = catPath.length ? catPath[catPath.length - 1] : null;
  const atLeaf = catCurrent != null && isLeaf(catCurrent);
  const catChildren = catCurrent ? (catCurrent.children ?? []) : getTree();
  const crumb = catPath.map((n) => label(n.name, locale));

  /** 该频道落在某目录子树下的书数。 */
  const channelCount = useCallback(
    (node: CategoryNode): number =>
      merged === null ? 0 : booksUnderTags(merged, node.tag).length,
    [merged],
  );

  /** 叶子层的书：按 根本 → 义注 → 复注 排序（同层按 book）。 */
  const leafBooks = useMemo<ChannelBook[]>(() => {
    if (merged === null || !atLeaf || !catCurrent) return [];
    return booksUnderTags(merged, catCurrent.tag).sort((a, b) => {
      const ra = KIND_RANK[bookKind(bookEntryAt(a.book, a.para)?.tags)];
      const rb = KIND_RANK[bookKind(bookEntryAt(b.book, b.para)?.tags)];
      return ra - rb || a.book - b.book;
    });
  }, [merged, atLeaf, catCurrent]);

  const openCategory = useCallback((child: CategoryNode) => {
    setCatPath((prev) => [...prev, child]);
  }, []);

  /** 点面包屑返回上级：切到第 index 项所在层级。 */
  const onCrumbPress = useCallback((index: number) => {
    setCatPath((prev) =>
      index >= prev.length - 1 ? prev : prev.slice(0, index + 1),
    );
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (merged === null) return [];
    if (view === "list") {
      return (visible ?? []).map((b) => ({
        key: `book-${b.book}`,
        kind: "book" as const,
        book: b,
      }));
    }
    if (atLeaf) {
      return leafBooks.map((b) => ({
        key: `book-${b.book}`,
        kind: "book" as const,
        book: b,
      }));
    }
    return catChildren.map((n) => ({
      key: `node-${n.name}`,
      kind: "node" as const,
      node: n,
    }));
  }, [merged, view, visible, atLeaf, leafBooks, catChildren]);

  const renderBook = useCallback(
    (b: ChannelBook) => {
      const layer = bookLayerAt(b.book, b.para);
      const meta = [
        layer
          ? t(
              layer === "mula"
                ? "layer.root"
                : (`layer.${layer}` as MessageKey),
            )
          : null,
        b.progress > 0
          ? t("channel.translated", { n: Math.round(b.progress * 100) })
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <BookDownloadCard
          book={b.book}
          title={bookTitle(b)}
          meta={meta}
          channelId={uid}
          paragraph={b.para}
          readonly={readonly}
          watch={bulk !== null}
          onPress={() => openBook(b)}
          onProgress={onProgress}
        />
      );
    },
    [bookTitle, openBook, onProgress, readonly, bulk, t, uid],
  );

  const renderItem: ListRenderItem<Row> = useCallback(
    ({ item }) => {
      if (item.kind === "book") return renderBook(item.book);
      const count = channelCount(item.node);
      return (
        <CategoryRow
          node={item.node}
          count={count}
          disabled={count === 0}
          onPress={() => openCategory(item.node)}
        />
      );
    },
    [channelCount, openCategory, renderBook],
  );

  const loading = merged === null;
  const emptyText = loading
    ? null
    : view === "category" && atLeaf && leafBooks.length === 0
      ? t("channel.category.empty")
      : view === "list" && visible && visible.length === 0
        ? (error ?? t("channel.emptyFiltered"))
        : null;

  const catTotal = atLeaf
    ? leafBooks.length
    : catCurrent
      ? channelCount(catCurrent)
      : (merged?.length ?? 0);

  const listHeader = (
    <View>
      {/* 频道信息 */}
      <View style={styles.info}>
        <Avatar uri={info?.studio?.avatar} name={studio || name} size={52} />
        <View style={styles.infoBody}>
          <Text style={styles.name}>{info?.name ?? name}</Text>
          {studio ? <Text style={styles.studio}>{studio}</Text> : null}
          {info?.summary ? (
            <Text style={styles.summary} numberOfLines={2}>
              {info.summary}
            </Text>
          ) : null}
        </View>
      </View>

      {/* 列表｜分类 工具条 */}
      <SegmentedControl<ViewMode>
        options={[
          { value: "list", label: t("channel.view.list") },
          { value: "category", label: t("channel.view.category") },
        ]}
        value={view}
        onChange={setView}
      />

      {view === "list" ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>
            {t("channel.books")}
            {visible ? ` · ${t("channel.bookCount", { n: visible.length })}` : ""}
          </Text>
          {!readonly && merged && merged.length > 0 ? (
            bulk ? (
              <Pressable style={styles.action} onPress={stopAll} hitSlop={6}>
                <Ionicons name="pause" size={16} color={colors.vermilion} />
                <Text style={styles.actionText}>
                  {t("channel.downloading", {
                    done: bulk.done,
                    total: bulk.total,
                  })}
                </Text>
              </Pressable>
            ) : (
              <Pressable style={styles.action} onPress={downloadAll} hitSlop={6}>
                <Ionicons
                  name="cloud-download-outline"
                  size={16}
                  color={colors.vermilion}
                />
                <Text style={styles.actionText}>{t("channel.downloadAll")}</Text>
              </Pressable>
            )
          ) : null}
        </View>
      ) : (
        <Breadcrumb
          items={crumb}
          trailing={t("categoryBrowse.count", { n: catTotal })}
          onPressItem={onCrumbPress}
          onPressHome={() => setCatPath([])}
          homeLabel={t("categoryBrowse.home")}
          flush
        />
      )}
    </View>
  );

  return (
    <Screen scroll={false} contentStyle={styles.contentFill}>
      <FlatList
        // view / 下钻路径变化时重挂载，顺带把滚动位置复位到顶。
        key={`${view}:${catPath.map((n) => n.name).join("/")}`}
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.vermilion} style={styles.loading} />
          ) : emptyText ? (
            <Text style={styles.empty}>{emptyText}</Text>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />

      {/* 过滤器菜单（贴着标题栏右上角落下） */}
      <Modal
        visible={menu}
        transparent
        animationType="fade"
        onRequestClose={() => setMenu(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenu(false)}>
          <View style={styles.menu}>
            {FILTERS.map((f) => (
              <Pressable
                key={f}
                style={styles.menuItem}
                onPress={() => {
                  setFilter(f);
                  setMenu(false);
                }}
              >
                <Text
                  style={[
                    styles.menuText,
                    filter === f && styles.menuTextActive,
                  ]}
                >
                  {t(FILTER_LABEL[f])}
                </Text>
                {filter === f ? (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color={colors.vermilion}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

/**
 * 同一本书可能有多条 level=1 记录（一个文件装多部作品）。下载是按 book
 * 整本下的，同 book 留进度最高的一条，免得列出两行一模一样的下载控件。
 */
function dedupe(rows: ChannelBook[]): ChannelBook[] {
  const best = new Map<number, ChannelBook>();
  for (const r of rows) {
    const hit = best.get(r.book);
    if (!hit || r.progress > hit.progress) best.set(r.book, r);
  }
  return [...best.values()].sort((a, b) => a.book - b.book);
}

const styles = StyleSheet.create({
  contentFill: {
    flex: 1,
    // Screen 的 scroll=false 容器自带 paddingVertical / paddingBottom，
    // 这里归零后由 FlatList 的 contentContainerStyle 统一控制，避免双重留白。
    paddingVertical: 0,
  },
  listContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  headerBtn: {
    paddingHorizontal: 4,
  },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  infoBody: {
    flex: 1,
  },
  name: {
    ...type.heading,
    fontFamily: serifFont,
  },
  studio: {
    ...type.caption,
    marginTop: 2,
  },
  summary: {
    ...type.small,
    marginTop: 4,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...type.heading,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionText: {
    ...type.caption,
    color: colors.vermilion,
  },
  loading: {
    marginTop: spacing.xl,
  },
  empty: {
    ...type.caption,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  menu: {
    position: "absolute",
    right: spacing.md,
    top: spacing.xxl * 3,
    minWidth: 160,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuText: {
    ...type.body,
  },
  menuTextActive: {
    color: colors.vermilion,
    fontWeight: "600",
  },
});
