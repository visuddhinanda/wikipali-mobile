/**
 * 译本频道详情：工作室信息 + 该频道下的书列表。
 *
 * 书列表是**服务端列表与本地下载记录的并集** —— 频道内容随时间会变，
 * 已经下过、如今服务端不再列出的书仍要能看到（和删除），否则那份缓存就
 * 成了删不掉的孤儿。已下载的排在最前面。
 *
 * 标题栏右上角的漏斗按钮按下载状态过滤（全部 / 已下载 / 下载中 / 未下载）。
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
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Avatar } from "../components/ChannelRow";
import { BookDownloadCard } from "../components/BookDownloadCard";
import {
  fetchChannel,
  fetchChannelBooks,
  studioLabel,
  type ChannelBook,
  type ChannelInfo,
} from "../api/channels";
import { bookEntryAt, bookLayerAt } from "../catalog";
import {
  downloadBook,
  isDownloading,
  listDownloads,
  pauseDownload,
  rememberChannelName,
  type DownloadProgress,
} from "../reading";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useT } from "../i18n/I18nContext";
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

/** 下载状态归到哪一档（暂停 / 失败都还没下完，算「未下载」）。 */
function bucket(p?: DownloadProgress): Exclude<Filter, "all"> {
  if (p?.status === "done") return "done";
  if (p?.status === "downloading") return "downloading";
  return "pending";
}

export function ChannelDetailScreen({ route, navigation }: Props) {
  const { uid, name, mode } = route.params;
  const t = useT();
  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const [books, setBooks] = useState<ChannelBook[] | null>(null);
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

  // 离开页面就别再往下下一本了 —— 批量下载是用户在这个页面上发起的动作。
  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        stopped.current = true;
      }),
    [navigation],
  );

  // 标题栏右上角的过滤器。
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
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
      ),
    });
  }, [navigation, filter]);

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

  const openBook = useCallback(
    (b: ChannelBook) =>
      navigation.navigate("Reader", {
        book: b.book,
        paragraph: b.para || undefined,
        title: bookTitle(b),
        channelId: uid,
        channelName: name,
      }),
    [navigation, uid, name],
  );

  const downloadAll = async () => {
    if (!merged) return;
    stopped.current = false;
    setBulk({ done: 0, total: merged.length });
    for (let i = 0; i < merged.length; i += 1) {
      if (stopped.current) break;
      setBulk({ done: i, total: merged.length });
      try {
        await downloadBook(uid, merged[i].book, undefined, merged[i].para);
      } catch {
        // 单本失败不该中断整批：书列表里那一行会显示失败状态。
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

  return (
    <Screen contentStyle={styles.content}>
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

      {merged === null ? (
        <ActivityIndicator color={colors.vermilion} style={styles.loading} />
      ) : visible && visible.length === 0 ? (
        <Text style={styles.empty}>{error ?? t("channel.emptyFiltered")}</Text>
      ) : (
        visible?.map((b) => {
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
              key={b.book}
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
        })
      )}

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

/** 书名：服务端的 title 常是空串，退回本地书目里该段所属的作品名。 */
function bookTitle(b: ChannelBook): string {
  return bookEntryAt(b.book, b.para)?.toc || b.title || String(b.book);
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
  content: {
    paddingTop: spacing.md,
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
