import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
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
  if (diff < hour) return t("common.minutesAgo", { n: Math.floor(diff / minute) });
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

  // 每次回到「书架」Tab 时重新加载阅读记录（读完返回可即时看到更新）。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadReadingHistory().then((r) => {
        if (alive) setRecords(r);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const readingList = records ?? [];

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
            const sub = [
              r.heading && r.heading !== r.title ? r.heading : null,
              r.channelName,
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
                    title: r.title,
                    channelId: r.channelId,
                    channelName: r.channelName,
                  })
                }
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {sub}
                  </Text>
                </View>
                <Text style={styles.rowTime}>{formatRelative(r.updatedAt, t)}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.vermilion}
                />
              </Pressable>
            );
          })}
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
