import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { useLayout } from "../hooks/useLayout";
import { getTree } from "../catalog";
import { label } from "../catalog/labels";
import { ChannelRow } from "../components/ChannelRow";
import { fetchTranslationChannels, type ChannelSummary } from "../api/channels";
import { useI18n } from "../i18n/I18nContext";
import { langFamily } from "../i18n";
import { colors, radius, spacing, type, cardShadow, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LANGUAGES = ["Pali", "中文", "缅文", "泰文", "僧伽罗"];

/** 「译本合集」只露前几个，全量在「书架 → 批量下载」里。 */
const CHANNEL_PREVIEW = 4;

export function DiscoverScreen() {
  const navigation = useNavigation<Nav>();
  const roots = getTree();
  // 卡片列数随宽度档变化（docs/README.md §4.5）。
  const { cardWidth } = useLayout();
  const { t, locale } = useI18n();
  const basketWidth = cardWidth(spacing.md);
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null);

  // 译本合集：按界面语言的语族取（简繁中文同为 zh，由服务端一并归拢）。
  useEffect(() => {
    let alive = true;
    fetchTranslationChannels(langFamily(locale))
      .then((rows) => alive && setChannels(rows.slice(0, CHANNEL_PREVIEW)))
      .catch(() => alive && setChannels([]));
    return () => {
      alive = false;
    };
  }, [locale]);

  return (
    <Screen contentStyle={styles.content}>
      {/* 搜索入口（常驻，跳转全局搜索） */}
      <Pressable style={styles.searchBar} onPress={() => undefined}>
        <Ionicons name="search" size={18} color={colors.inkFaint} />
        <Text style={styles.searchPlaceholder}>
          {t("discover.searchPlaceholder")}
        </Text>
      </Pressable>

      {/* 巴利三藏入口 */}
      <Text style={styles.sectionTitle}>{t("discover.tipitaka")}</Text>
      <View style={styles.basketGrid}>
        {roots.map((node) => (
          <Pressable
            key={node.name}
            style={[styles.basketCard, { width: basketWidth }]}
            onPress={() =>
              navigation.navigate("CategoryBrowse", {
                node,
                breadcrumb: [label(node.name, locale)],
              })
            }
          >
            <Text style={styles.basketZh}>{label(node.name, locale)}</Text>
            <Text style={styles.basketEn}>{node.name}</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.vermilion}
              style={styles.basketChevron}
            />
          </Pressable>
        ))}
      </View>

      {/* 译本合集（wikipali 上的译本频道，取前几个） */}
      <Text style={styles.sectionTitle}>{t("discover.channels")}</Text>
      {channels === null ? (
        <ActivityIndicator color={colors.vermilion} style={styles.loading} />
      ) : (
        channels.map((c) => (
          <ChannelRow
            key={c.id}
            channel={c}
            onPress={() =>
              navigation.navigate("ChannelDetail", { uid: c.id, name: c.name })
            }
          />
        ))
      )}
      <View style={styles.sectionGap} />

      {/* 作者（语文）筛选 */}
      <Text style={styles.sectionTitle}>{t("discover.authors")}</Text>
      <View style={styles.chips}>
        {LANGUAGES.map((l) => (
          <View key={l} style={styles.chip}>
            <Text style={styles.chipText}>{l}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.paperSunken,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  searchPlaceholder: {
    ...type.caption,
    color: colors.inkFaint,
  },
  sectionTitle: {
    ...type.heading,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  basketGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  basketCard: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    ...cardShadow,
  },
  basketZh: {
    ...type.heading,
    fontFamily: serifFont,
  },
  basketEn: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  basketChevron: {
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
  },
  loading: {
    marginVertical: spacing.lg,
  },
  sectionGap: {
    height: spacing.lg,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.paperRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chipText: {
    ...type.caption,
  },
});
