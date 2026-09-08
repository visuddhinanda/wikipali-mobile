import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { ChannelRow } from "../components/ChannelRow";
import { bookEntryAt, bookLayerAt } from "../catalog";
import { channelNames, listDownloads } from "../reading";
import { fetchChannel, type ChannelSummary } from "../api/channels";
import { loadReadingHistory, type ReadingRecord } from "../data/history";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Tab 的稳定 id（不再用中文当键，文案交给 i18n）。 */
const TABS = ["reading", "downloaded", "starred"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABEL: Record<TabId, MessageKey> = {
  reading: "bookshelf.tab.reading",
  downloaded: "bookshelf.tab.downloaded",
  starred: "bookshelf.tab.starred",
};

const EMPTY: Record<TabId, { title: MessageKey; sub: MessageKey }> = {
  reading: {
    title: "bookshelf.empty.reading.title",
    sub: "bookshelf.empty.reading.sub",
  },
  downloaded: {
    title: "bookshelf.empty.downloaded.title",
    sub: "bookshelf.empty.downloaded.sub",
  },
  starred: {
    title: "bookshelf.empty.starred.title",
    sub: "bookshelf.empty.starred.sub",
  },
};

/** epoch ms → 相对时间。 */
function formatRelative(
  ts: number | undefined,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t("common.justNow");
  if (diff < hour)
    return t("common.minutesAgo", { n: Math.floor(diff / minute) });
  if (diff < day) return t("common.hoursAgo", { n: Math.floor(diff / hour) });
  if (diff < 7 * day) return t("common.daysAgo", { n: Math.floor(diff / day) });
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function BookshelfScreen() {
  const navigation = useNavigation<Nav>();
  const t = useT();
  const [active, setActive] = useState<TabId>("reading");
  const [records, setRecords] = useState<ReadingRecord[] | null>(null);
  // 「已下载」按频道归拢：一个频道一张卡，点进去就是批量下载那张详情页。
  const [channels, setChannels] = useState<DownloadedChannel[] | null>(null);
  // 版本名不存在记录里 —— uid → name 现查，服务端改了名这里立刻跟上。
  const [names, setNames] = useState<Map<string, string>>(new Map());

  // 每次回到「书架」Tab 时重新加载（读完/下载完返回可即时看到更新）。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadReadingHistory().then((r) => {
        if (!alive) return;
        setRecords(r);
        channelNames(r.map((x) => x.channelId ?? "")).then((m) => {
          if (alive) setNames(m);
        });
      });
      loadDownloadedChannels().then((c) => {
        if (alive) setChannels(c);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const readingList = records ?? [];
  const channelList = channels ?? [];

  /**
   * 列表标题用 level=1 的作品名（`toc`），不是丛书名 —— 一个 book 文件
   * 可能装着多部作品，丛书名对读者没有定位作用。
   */
  const workTitle = (
    book: number,
    paragraph?: number,
    fallback?: string,
  ): string => bookEntryAt(book, paragraph)?.toc ?? fallback ?? String(book);

  /** 版本显示名：现查 channels 表；查不到才退回旧记录里的名字快照。 */
  const channelLabel = (uid?: string, legacy?: string): string | undefined =>
    (uid ? names.get(uid) : undefined) ?? legacy;

  /** 层次 tag（根本 / 义注 / 复注 / 再复注），放在副标题开头。 */
  const layerTag = (book: number, paragraph?: number): string | null => {
    const layer = bookLayerAt(book, paragraph);
    if (!layer) return null;
    // 「原文」在对读标签栏里叫原文，在书架这里按书的性质叫「根本」。
    return t(
      layer === "mula" ? "layer.root" : (`layer.${layer}` as MessageKey),
    );
  };

  return (
    <Screen contentStyle={styles.content}>
      {/* 二级切换 */}
      <View style={styles.segment}>
        {TABS.map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.segmentItem,
              active === tab && styles.segmentItemActive,
            ]}
            onPress={() => setActive(tab)}
          >
            <Text
              style={[
                styles.segmentText,
                active === tab && styles.segmentTextActive,
              ]}
            >
              {t(TAB_LABEL[tab])}
            </Text>
          </Pressable>
        ))}
      </View>

      {active === "reading" && readingList.length > 0 ? (
        <View>
          {readingList.map((r) => {
            const title = workTitle(r.book, r.paragraph, r.title);
            const sub = [
              layerTag(r.book, r.paragraph),
              r.heading && r.heading !== title ? r.heading : null,
              channelLabel(r.channelId, r.channelName),
              `${r.book}-${r.paragraph}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Pressable
                key={String(r.book)}
                style={styles.row}
                onPress={() =>
                  navigation.navigate("Reader", {
                    book: r.book,
                    paragraph: r.paragraph,
                    title,
                    channelId: r.channelId,
                    channelName: channelLabel(r.channelId, r.channelName),
                  })
                }
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {sub}
                  </Text>
                </View>
                <Text style={styles.rowTime}>
                  {formatRelative(r.updatedAt, t)}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.vermilion}
                />
              </Pressable>
            );
          })}
        </View>
      ) : active === "downloaded" && channelList.length > 0 ? (
        <View>
          {channelList.map((c) => (
            <ChannelRow
              key={c.summary.id}
              channel={c.summary}
              subtitle={t("bookshelf.downloadedBooks", { n: c.books })}
              onPress={() =>
                navigation.navigate("ChannelDetail", {
                  uid: c.summary.id,
                  name: c.summary.name,
                  mode: "download",
                })
              }
            />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="book-outline" size={44} color={colors.inkFaint} />
          <Text style={styles.emptyTitle}>{t(EMPTY[active].title)}</Text>
          <Text style={styles.emptySubtitle}>{t(EMPTY[active].sub)}</Text>
        </View>
      )}
    </Screen>
  );
}

interface DownloadedChannel {
  summary: ChannelSummary;
  /** 该频道下有缓存的书本数。 */
  books: number;
}

/**
 * 本地下载记录按频道归拢。
 *
 * 名字先用本地 `channels` 表（离线也有），再尽量向服务端要工作室头像 ——
 * 拿不到就退回首字占位，不该因为没网就让「已下载」空着。
 */
async function loadDownloadedChannels(): Promise<DownloadedChannel[]> {
  const rows = (await listDownloads()).filter((d) => d.done > 0);
  const byChannel = new Map<string, { books: number; updatedAt: number }>();
  for (const r of rows) {
    const hit = byChannel.get(r.channel) ?? { books: 0, updatedAt: 0 };
    byChannel.set(r.channel, {
      books: hit.books + 1,
      updatedAt: Math.max(hit.updatedAt, r.updatedAt),
    });
  }

  const uids = [...byChannel.keys()];
  const local = await channelNames(uids);
  const infos = await Promise.all(
    uids.map((uid) => fetchChannel(uid).catch(() => null)),
  );

  return uids
    .map((uid, i) => {
      const info = infos[i];
      const stat = byChannel.get(uid)!;
      return {
        summary: {
          id: uid,
          name: info?.name ?? local.get(uid) ?? uid,
          summary: info?.summary ?? null,
          lang: info?.lang,
          count: 0,
          studio: info?.studio,
        },
        books: stat.books,
        updatedAt: stat.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.paperSunken,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.lg,
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentItemActive: {
    backgroundColor: colors.paperRaised,
  },
  segmentText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  segmentTextActive: {
    color: colors.vermilion,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  rowSub: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  rowTime: {
    ...type.small,
    marginRight: spacing.sm,
    color: colors.inkFaint,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...type.heading,
  },
  emptySubtitle: {
    ...type.caption,
    textAlign: "center",
    maxWidth: 280,
  },
});
