import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "../theme";

interface BreadcrumbProps {
  /** 从根到当前节点的显示名（最后一个是当前节点）。 */
  items: string[];
  /** 面包屑右侧的附加文案（如「 · {n} 项」），可选。 */
  trailing?: string;
}

/**
 * 三藏目录的层级路径（面包屑）。
 *
 * 分类树（`CategoryBrowse`）→ 章节列表（`ChapterList`）→ 版本选择
 * （`BookChannels`）共用，保证下钻到版本选择界面前路径始终可见。
 */
export function Breadcrumb({ items, trailing }: BreadcrumbProps) {
  return (
    <View style={styles.row}>
      {items.map((name, i) => (
        <Text key={`${name}-${i}`} style={styles.text}>
          {i > 0 ? "  /  " : ""}
          {name}
        </Text>
      ))}
      {trailing != null && trailing !== "" ? (
        <Text style={styles.trailing}>{trailing}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  text: {
    ...type.caption,
    color: colors.inkSoft,
  },
  trailing: {
    ...type.caption,
    color: colors.inkFaint,
  },
});
