import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { ProgressRing } from "../components/ProgressRing";
import { DownloadIconButton } from "../components/DownloadIconButton";
import { getBookChannels } from "../api";
import { loadReadingHistory } from "../data/history";
import type { ChapterChannel } from "../catalog";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n/I18nContext";
import type { Locale, MessageKey } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "BookChannels">;

/** 频道类型 → 分组标题的文案 key（Nissaya 是专名，不翻译）。 */
const TYPE_LABEL: Record<string, MessageKey> = {
  translation: "channels.translation",
  original: "channels.original",
  wbw: "channels.wbw",
  commentary: "channels.commentary",
};

/** 分组展示顺序；不在列表里的类型追加到末尾。 */
const GROUP_ORDER = ["translation", "nissaya", "original", "wbw"] as const;

/** 每组超过该数量即折叠（默认只显示前 4 个）。 */
const COLLAPSE_AT = 4;

/** 0-9 的汉字数字。 */
const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 整数转汉字数字（1-99；更大则回退阿拉伯数字）。 */
function toCn(n: number): string {
  if (n < 10) return CN_DIGITS[n] ?? String(n);
  if (n < 20) return `十${n % 10 === 0 ? "" : CN_DIGITS[n % 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${CN_DIGITS[tens]}十${ones === 0 ? "" : CN_DIGITS[ones]}`;
  }
  return String(n);
}

/**
 * 把 updated_at（ISO 8601）换算成「三天前 / 一个月前 / 一年前」这类相对时间。
 * 中文用汉字数字（「三天前」），其他语言用阿拉伯数字。
 */
function formatRelativeTime(
  iso: string | undefined,
  locale: Locale,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diffMs = Date.now() - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  const num = (n: number) => (locale === "zh-Hans" ? toCn(n) : String(n));

  if (diffMs < minute) return t("common.justNow");
  if (diffMs < hour)
    return t("common.minutesAgo", { n: num(Math.floor(diffMs / minute)) });
  if (diffMs < day)
    return t("common.hoursAgo", { n: num(Math.floor(diffMs / hour)) });
  if (diffMs < month)
    return t("common.daysAgo", { n: num(Math.floor(diffMs / day)) });
  if (diffMs < year)
    return t("common.monthsAgo", { n: num(Math.floor(diffMs / month)) });
  return t("common.yearsAgo", { n: num(Math.floor(diffMs / year)) });
}

interface ChannelSection {
  key: string;
  label: string;
  total: number;
  over: boolean;
  expanded: boolean;
  data: ChapterChannel[];
}

export function BookChannelsScreen({ route, navigation }: Props) {
  const { book, paragraph, title } = route.params;
  // 上次读到哪一段：从版本列表进阅读器时接着上次读，而不是每次都从头开始。
  // 只在这里查一次（进列表时），点版本时直接用。
  const [lastParagraph, setLastParagraph] = useState<number | null>(null);
  const [channels, setChannels] = useState<ChapterChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { t, locale } = useI18n();

  // 每次回到这个页面都重读 —— 只在挂载时读的话，从阅读器返回后拿到的还是
  // 进去之前的位置，「接着上次读」永远慢一拍。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadReadingHistory().then((records) => {
        if (!alive) return;
        const hit = records.find((r) => r.book === book);
        setLastParagraph(hit?.paragraph ?? null);
      });
      return () => {
        alive = false;
      };
    }, [book]),
  );

  useEffect(() => {
    let alive = true;
    getBookChannels(book, paragraph)
      .then((rows) => {
        if (alive) setChannels(rows);
      })
      .catch((err) => {
        if (alive)
          setError(err instanceof Error ? err.message : t("common.loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [book, paragraph]);

  const sections = useMemo<ChannelSection[]>(() => {
    if (!channels) return [];

    // 分组顺序：固定顺序 + 未知类型兜底
    const order: string[] = [...GROUP_ORDER];
    const known = new Set<string>(GROUP_ORDER);
    for (const c of channels) {
      if (!known.has(c.type)) {
        known.add(c.type);
        order.push(c.type);
      }
    }

    return order
      .map((kind) => {
        const data = channels.filter((c) => c.type === kind);
        const total = data.length;
        const over = total > COLLAPSE_AT;
        const isExpanded = !!expanded[kind];
        const key = TYPE_LABEL[kind];
        return {
          key: kind,
          // 未知类型没有对应文案，直接显示后端给的原值。
          label: key ? t(key) : kind,
          total,
          over,
          expanded: isExpanded,
          data: over && !isExpanded ? data.slice(0, COLLAPSE_AT) : data,
        };
      })
      .filter((s) => s.total > 0);
  }, [channels, expanded, t]);

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  if (error) {
    return (
      <Screen contentStyle={styles.center}>
        <Ionicons name="cloud-offline" size={40} color={colors.inkFaint} />
        <Text style={styles.centerText}>{error}</Text>
      </Screen>
    );
  }

  if (!channels) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator color={colors.vermilion} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.contentFill}>
      <View style={styles.subheader}>
        <Text style={styles.subheaderText}>
          {t("channels.count", { title, n: channels.length })}
        </Text>
      </View>
      {channels.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="library-outline" size={40} color={colors.inkFaint} />
          <Text style={styles.centerText}>{t("channels.empty")}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.uid}
          style={styles.sectionList}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <Text style={styles.sectionCount}>
                {t("channels.groupCount", { n: section.total })}
              </Text>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.over ? (
              <Pressable
                style={styles.foldBtn}
                onPress={() => toggle(section.key)}
                hitSlop={6}
              >
                <Text style={styles.foldBtnText}>
                  {section.expanded
                    ? t("channels.collapse")
                    : t("channels.expandRest", {
                        n: section.total - COLLAPSE_AT,
                      })}
                </Text>
                <Ionicons
                  name={section.expanded ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.ochre}
                />
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                navigation.navigate("Reader", {
                  book,
                  // 有阅读记录就接着上次读；没有才用目录点进来的锚点。
                  paragraph: lastParagraph ?? paragraph,
                  title,
                  channelId: item.channel_id,
                  channelName: item.name,
                })
              }
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                {item.channel && item.channel.name !== item.name ? (
                  <Text style={styles.rowSub}>{item.channel.name}</Text>
                ) : null}
                {item.updated_at ? (
                  <Text style={styles.rowTime}>
                    {formatRelativeTime(item.updated_at, locale, t)}
                  </Text>
                ) : null}
              </View>
              {/* 这个环是「译文完成度」，不是下载进度 —— 别混淆 */}
              <View style={styles.ringWrap}>
                <ProgressRing
                  progress={item.progress}
                  size={30}
                  strokeWidth={3}
                  trackColor={colors.border}
                />
              </View>
              {/* 离线下载：选哪个版本就下哪个，不必先进阅读器 */}
              <View style={styles.downloadWrap}>
                <DownloadIconButton
                  book={book}
                  channelId={item.channel_id}
                  color={colors.inkSoft}
                  paragraph={item.para}
                />
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.vermilion}
              />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  centerText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  subheader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  subheaderText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  contentFill: {
    flex: 1,
  },
  sectionList: {
    flex: 1,
  },
  list: {
    padding: spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionLabel: {
    ...type.caption,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  sectionCount: {
    ...type.small,
    color: colors.inkFaint,
  },
  foldBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  foldBtnText: {
    ...type.small,
    fontWeight: "600",
    color: colors.ochre,
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
    marginTop: 2,
    color: colors.inkFaint,
  },
  downloadWrap: {
    marginRight: spacing.sm,
  },
  ringWrap: {
    marginRight: spacing.sm,
  },
});
