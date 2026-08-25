import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

const TOOLS: { icon: IoniconName; title: string; desc: string }[] = [
  { icon: "search", title: "字典", desc: "逐词查询 · 最近历史" },
  { icon: "calendar", title: "佛教日历", desc: "布萨日 · 结夏安居" },
  { icon: "swap-horizontal", title: "编码转换", desc: "罗马转写 · 悉昙 · 缅泰文" },
];

export function ToolsScreen() {
  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.grid}>
        {TOOLS.map((t) => (
          <Pressable key={t.title} style={styles.card} onPress={() => undefined}>
            <View style={styles.cardIcon}>
              <Ionicons name={t.icon} size={24} color={colors.vermilion} />
            </View>
            <Text style={styles.cardTitle}>{t.title}</Text>
            <Text style={styles.cardDesc}>{t.desc}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  card: {
    width: "47%",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.paperSunken,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  cardTitle: {
    ...type.heading,
  },
  cardDesc: {
    ...type.small,
    marginTop: 4,
    color: colors.inkSoft,
  },
});
