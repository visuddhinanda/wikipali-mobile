import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type } from "../theme";

interface BreadcrumbProps {
  /** 从根到当前节点的显示名（最后一个是当前节点）。 */
  items: string[];
  /** 面包屑右侧的附加文案（如「 · {n} 项」），可选。 */
  trailing?: string;
  /** 传入后各项可点，点击回调对应下标（用于下钻后返回上级）。 */
  onPressItem?: (index: number) => void;
  /** 传入后在开头渲染一个 home 图标，点击返回分类根（顶层）。 */
  onPressHome?: () => void;
  /** home 图标的无障碍名称。 */
  homeLabel?: string;
  /** 去掉左右内边距（放在已经限宽的容器里、需要与上下内容对齐时用）。 */
  flush?: boolean;
}

/**
 * 三藏目录的层级路径（面包屑）。
 *
 * 分类树（`CategoryBrowse`）→ 章节列表（`ChapterList`）→ 版本选择
 * （`BookChannels`）共用，保证下钻到版本选择界面前路径始终可见。
 * 传入 `onPressItem` 时各项可点：频道详情里的「分类视图」用它在同一页内
 * 返回上级，而不是像独立屏幕那样靠导航头返回；`onPressHome` 额外提供
 * 「回到分类根」的 home 入口。
 */
export function Breadcrumb({
  items,
  trailing,
  onPressItem,
  onPressHome,
  homeLabel,
  flush,
}: BreadcrumbProps) {
  const hasHome = onPressHome != null;
  return (
    <View style={[styles.row, flush && styles.rowFlush]}>
      {hasHome ? (
        <Pressable
          onPress={onPressHome}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={homeLabel}
          style={styles.homeBtn}
        >
          <Ionicons name="home-outline" size={16} color={colors.inkSoft} />
        </Pressable>
      ) : null}
      {items.map((name, i) =>
        onPressItem ? (
          <Pressable
            key={`${name}-${i}`}
            onPress={() => onPressItem(i)}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.text}>
              {i > 0 || hasHome ? "  /  " : ""}
              {name}
            </Text>
          </Pressable>
        ) : (
          <Text key={`${name}-${i}`} style={styles.text}>
            {i > 0 || hasHome ? "  /  " : ""}
            {name}
          </Text>
        ),
      )}
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
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowFlush: {
    paddingHorizontal: 0,
  },
  homeBtn: {
    marginRight: spacing.xs,
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
