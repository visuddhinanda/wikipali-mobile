import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { useLayout } from "../hooks/useLayout";
import { getTree } from "../catalog";
import { labelZh } from "../catalog/labels";
import { colors, radius, spacing, type, cardShadow, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LANGUAGES = ["Pali", "中文", "缅文", "泰文", "僧伽罗"];

/** 推荐条目（P0 演示：直接落到 mock 阅读器）。 */
const FEATURED = [
  { title: "转法轮经", subtitle: "SN 56.11 · 四圣谛", book: 5, paragraph: 5 },
  { title: "无我相经", subtitle: "SN 22.59 · 五蕴无我", book: 6, paragraph: 6 },
  { title: "慈经", subtitle: "Khp 9 · Mettā Sutta", book: 7, paragraph: 7 },
];

export function DiscoverScreen() {
  const navigation = useNavigation<Nav>();
  const roots = getTree();
  // 卡片列数随宽度档变化（DESIGN.md §4.5）。
  const { cardWidth } = useLayout();
  const basketWidth = cardWidth(spacing.md);

  return (
    <Screen contentStyle={styles.content}>
      {/* 搜索入口（常驻，跳转全局搜索） */}
      <Pressable style={styles.searchBar} onPress={() => undefined}>
        <Ionicons name="search" size={18} color={colors.inkFaint} />
        <Text style={styles.searchPlaceholder}>搜索经文、词条…</Text>
      </Pressable>

      {/* 巴利三藏入口 */}
      <Text style={styles.sectionTitle}>巴利三藏</Text>
      <View style={styles.basketGrid}>
        {roots.map((node) => (
          <Pressable
            key={node.name}
            style={[styles.basketCard, { width: basketWidth }]}
            onPress={() =>
              navigation.navigate("CategoryBrowse", {
                node,
                breadcrumb: [labelZh(node.name)],
              })
            }
          >
            <Text style={styles.basketZh}>{labelZh(node.name)}</Text>
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

      {/* 推荐 / 最近更新 */}
      <Text style={styles.sectionTitle}>推荐 · 最近更新</Text>
      {FEATURED.map((f) => (
        <Pressable
          key={f.book}
          style={styles.featured}
          onPress={() =>
            navigation.navigate("Reader", {
              book: f.book,
              paragraph: f.paragraph,
              title: f.title,
            })
          }
        >
          <View style={styles.featuredBody}>
            <Text style={styles.featuredTitle}>{f.title}</Text>
            <Text style={styles.featuredSubtitle}>{f.subtitle}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={colors.vermilion} />
        </Pressable>
      ))}

      {/* 作者（语文）筛选 */}
      <Text style={styles.sectionTitle}>作者（语文）</Text>
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
  featured: {
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
  featuredBody: {
    flex: 1,
  },
  featuredTitle: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  featuredSubtitle: {
    ...type.caption,
    marginTop: 2,
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
