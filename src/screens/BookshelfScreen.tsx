import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { loadReadingHistory, type ReadingRecord } from "../data/history";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TABS = ["在读", "已下载", "收藏"] as const;

const EMPTY: Record<(typeof TABS)[number], { title: string; sub: string }> = {
  在读: {
    title: "还没有阅读记录",
    sub: "从「分类」进入经文开始阅读，进度会自动出现在这里。",
  },
  已下载: {
    title: "暂无下载",
    sub: "下载的经文会出现在这里，可离线阅读。",
  },
  收藏: {
    title: "暂无收藏",
    sub: "收藏的经文会出现在这里。",
  },
};

/** epoch ms → 相对时间。 */
function formatRelative(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function BookshelfScreen() {
  const navigation = useNavigation<Nav>();
  const [active, setActive] = useState<(typeof TABS)[number]>("在读");
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
        {TABS.map((t) => (
          <Pressable
            key={t}
            style={[styles.segmentItem, active === t && styles.segmentItemActive]}
            onPress={() => setActive(t)}
          >
            <Text
              style={[
                styles.segmentText,
                active === t && styles.segmentTextActive,
              ]}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      {active === "在读" && readingList.length > 0 ? (
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
                <Text style={styles.rowTime}>{formatRelative(r.updatedAt)}</Text>
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
          <Text style={styles.emptyTitle}>{EMPTY[active].title}</Text>
          <Text style={styles.emptySubtitle}>{EMPTY[active].sub}</Text>
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
