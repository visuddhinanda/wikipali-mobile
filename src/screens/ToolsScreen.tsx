import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useLayout } from "../hooks/useLayout";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

type IoniconName = keyof typeof Ionicons.glyphMap;

const TOOLS: { icon: IoniconName; title: MessageKey; desc: MessageKey }[] = [
  { icon: "search", title: "tools.dict.title", desc: "tools.dict.desc" },
  {
    icon: "calendar",
    title: "tools.calendar.title",
    desc: "tools.calendar.desc",
  },
  {
    icon: "swap-horizontal",
    title: "tools.transcode.title",
    desc: "tools.transcode.desc",
  },
];

export function ToolsScreen() {
  const t = useT();
  // 卡片列数随宽度档变化（DESIGN.md §4.5）。
  const { cardWidth } = useLayout();
  const width = cardWidth(spacing.md);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.grid}>
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.title}
            style={[styles.card, { width }]}
            onPress={() => undefined}
          >
            <View style={styles.cardIcon}>
              <Ionicons name={tool.icon} size={24} color={colors.vermilion} />
            </View>
            <Text style={styles.cardTitle}>{t(tool.title)}</Text>
            <Text style={styles.cardDesc}>{t(tool.desc)}</Text>
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
