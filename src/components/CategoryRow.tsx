import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isLeaf, type CategoryNode } from "../catalog";
import { label } from "../catalog/labels";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing, type, serifFont } from "../theme";

interface Props {
  node: CategoryNode;
  /** 右侧计数（项数 / 书数）；不给就不显示。 */
  count?: number | null;
  /** 禁用态：不可点、整行淡出（书数为 0 的节点用它标记「无内容可下钻」）。 */
  disabled?: boolean;
  onPress: () => void;
}

/**
 * 三藏目录树的一行：译文名 + 巴利名 + 计数 + 箭头。
 *
 * 「分类」栏目（`CategoryBrowseScreen`）与频道详情里的「分类视图」共用：
 * 前者计数是子节点数，后者计数是该频道落在该子树下的书数。叶子行用
 * `arrow-forward` 表示「进入结果」，非叶子用 `chevron-forward` 表示「下钻」。
 */
export function CategoryRow({ node, count, disabled, onPress }: Props) {
  const { locale } = useI18n();
  const leaf = isLeaf(node);

  return (
    <Pressable
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowZh}>{label(node.name, locale)}</Text>
        <Text style={styles.rowPali}>{node.name}</Text>
      </View>
      {count != null ? <Text style={styles.rowCount}>{count}</Text> : null}
      <Ionicons
        name={leaf ? "arrow-forward" : "chevron-forward"}
        size={18}
        color={colors.vermilion}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  rowZh: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  rowPali: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  rowCount: {
    ...type.small,
    marginRight: spacing.sm,
    color: colors.inkFaint,
  },
  rowDisabled: {
    opacity: 0.4,
  },
});
