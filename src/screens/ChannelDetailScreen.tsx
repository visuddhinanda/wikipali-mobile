/**
 * 译本频道详情：工作室信息 + 该频道下的书列表。
 *
 * 从分类页进来是「浏览」（点书直接读），从书架「批量下载」进来是 download
 * 模式：每本书带下载控件，顶部还有「全部下载」（逐本串行，别把服务端打爆）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Avatar } from "../components/ChannelRow";
import { DownloadControl } from "../components/DownloadControl";
import {
  fetchChannel,
  fetchChannelBooks,
  studioLabel,
  type ChannelBook,
  type ChannelInfo,
} from "../api/channels";
import { bookEntryAt, bookLayerAt } from "../catalog";
import { downloadBook, isDownloading, pauseDownload } from "../reading";
import { rememberChannelName } from "../reading";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "ChannelDetail">;

export function ChannelDetailScreen({ route, navigation }: Props) {
  const { uid, name, mode } = route.params;
  const t = useT();
  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const [books, setBooks] = useState<ChannelBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 「全部下载」的进度（第几本 / 共几本）；null 表示没在批量下载。
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(
    null,
  );
  const stopped = useRef(false);

  useEffect(() => {
    let alive = true;
    // 频道名先记进本地 channels 表：书架列表靠它把 uid 显示成人话。
    void rememberChannelName(uid, name);
    fetchChannel(uid)
      .then((c) => alive && setInfo(c))
      .catch(() => undefined);
    fetchChannelBooks(uid)
      .then((rows) => alive && setBooks(dedupe(rows)))
      .catch((err) =>
        alive
          ? setError(
              err instanceof Error ? err.message : t("common.loadFailed"),
            )
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

  const openBook = useCallback(
    (b: ChannelBook) =>
      navigation.navigate("Reader", {
        book: b.book,
        paragraph: b.para,
        title: bookTitle(b),
        channelId: uid,
        channelName: name,
      }),
    [navigation, uid, name],
  );

  const downloadAll = async () => {
    if (!books) return;
    stopped.current = false;
    setBulk({ done: 0, total: books.length });
    for (let i = 0; i < books.length; i += 1) {
      if (stopped.current) break;
      setBulk({ done: i, total: books.length });
      try {
        await downloadBook(uid, books[i].book);
      } catch {
        // 单本失败不该中断整批：书列表里那一行会显示失败状态。
      }
    }
    setBulk(null);
  };

  const stopAll = () => {
    stopped.current = true;
    const running = books?.find((b) => isDownloading(uid, b.book));
    if (running) pauseDownload(uid, running.book);
    setBulk(null);
  };

  const studio = studioLabel(info?.studio);

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
          {books ? ` · ${t("channel.bookCount", { n: books.length })}` : ""}
        </Text>
        {mode === "download" && books && books.length > 0 ? (
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

      {error ? (
        <Text style={styles.empty}>{error}</Text>
      ) : books === null ? (
        <ActivityIndicator color={colors.vermilion} style={styles.loading} />
      ) : (
        books.map((b) => {
          const layer = bookLayerAt(b.book, b.para);
          const sub = [
            layer
              ? t(
                  layer === "mula"
                    ? "layer.root"
                    : (`layer.${layer}` as MessageKey),
                )
              : null,
            t("channel.translated", { n: Math.round(b.progress * 100) }),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <View key={`${b.book}-${b.para}`} style={styles.card}>
              <Pressable style={styles.cardHead} onPress={() => openBook(b)}>
                <View style={styles.cardBody}>
                  <Text style={styles.bookTitle} numberOfLines={1}>
                    {bookTitle(b)}
                  </Text>
                  <Text style={styles.bookSub} numberOfLines={1}>
                    {sub}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.vermilion}
                />
              </Pressable>
              {mode === "download" ? (
                <DownloadControl
                  book={b.book}
                  channelId={uid}
                  watch={bulk !== null}
                  colors={{
                    ink: colors.ink,
                    inkSoft: colors.inkSoft,
                    inkFaint: colors.inkFaint,
                    accent: colors.vermilion,
                    track: colors.hairline,
                  }}
                />
              ) : null}
            </View>
          );
        })
      )}
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
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardBody: {
    flex: 1,
  },
  bookTitle: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  bookSub: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  loading: {
    marginTop: spacing.xl,
  },
  empty: {
    ...type.caption,
    textAlign: "center",
    marginTop: spacing.xl,
  },
});
