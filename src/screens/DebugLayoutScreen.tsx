/**
 * 布局调试页（仅 __DEV__ 可见）——实时显示 `useLayout()` 的判定结果。
 *
 * 用途：拖动窗口 / 旋转 / 改系统字号时，直接看断点落在哪一档，
 * 排除「以为没生效，其实是宽度没跨过线」的误判（docs/README.md §4.9 验证矩阵）。
 */
import React from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useLayout } from "../hooks/useLayout";
import {
  BREAKPOINTS,
  DUAL_COLUMN_MIN_WIDTH,
  SIDENOTE_MARGIN_MIN_WIDTH,
} from "../theme/breakpoints";

function Row({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, hi && styles.vHi]}>{v}</Text>
    </View>
  );
}

export function DebugLayoutScreen() {
  const { fontScale, scale } = useWindowDimensions();
  const l = useLayout();
  const n = (x: number) => String(Math.round(x));

  // 距离下一档还差多少 dp
  const next =
    l.widthClass === "compact"
      ? BREAKPOINTS.medium
      : l.widthClass === "medium"
        ? BREAKPOINTS.expanded
        : l.widthClass === "expanded"
          ? BREAKPOINTS.large
          : null;

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{l.widthClass}</Text>
      </View>

      <Text style={styles.section}>窗口</Text>
      <View style={styles.card}>
        <Row k="width × height" v={`${n(l.width)} × ${n(l.height)} dp`} hi />
        <Row k="fontScale" v={fontScale.toFixed(2)} />
        <Row k="pixelRatio" v={scale.toFixed(2)} />
        <Row k="像素宽（估算）" v={`${n(l.width * scale)} px`} />
        <Row k="有效宽度 width/fontScale" v={`${n(l.effectiveWidth)} dp`} hi />
        <Row
          k="距下一档"
          v={next ? `还差 ${n(next - l.effectiveWidth)} dp（${next}）` : "已是最宽档"}
        />
      </View>

      <Text style={styles.section}>判定结果</Text>
      <View style={styles.card}>
        <Row k="widthClass" v={l.widthClass} hi />
        <Row k="导航容器" v={`${l.navKind}（${n(l.navWidth)} dp）`} hi />
        <Row k="内容限宽" v={l.maxContentWidth ? `${l.maxContentWidth} dp` : "不限宽"} />
        <Row k="内容净宽" v={`${n(l.contentWidth)} dp`} />
        <Row k="外边距" v={`${l.gutter} dp`} />
        <Row k="卡片列数" v={String(l.cardColumns)} />
        <Row k="矮窗口" v={l.isShort ? "是（< 480 dp）" : "否"} />
        <Row k="list-detail 双栏" v={l.listDetail ? "启用" : "关闭"} hi />
      </View>

      <Text style={styles.section}>阅读器阈值</Text>
      <View style={styles.card}>
        <Row
          k={`边注栏 ≥ ${SIDENOTE_MARGIN_MIN_WIDTH}`}
          v={l.width >= SIDENOTE_MARGIN_MIN_WIDTH ? "满足（按整窗估算）" : "不满足"}
        />
        <Row
          k={`双列对照 ≥ ${DUAL_COLUMN_MIN_WIDTH}`}
          v={l.canDualColumn(l.width - l.navWidth) ? "满足（列表栏收起时）" : "不满足"}
        />
        <Text style={styles.hint}>
          阅读器内以 onLayout 实测的净宽为准，这里按「整窗 − 导航容器」估算。
        </Text>
      </View>

      <Text style={styles.section}>断点表</Text>
      <View style={styles.card}>
        <Row k="compact" v="< 600 dp" hi={l.widthClass === "compact"} />
        <Row k="medium" v="600 – 839 dp" hi={l.widthClass === "medium"} />
        <Row k="expanded" v="840 – 1199 dp" hi={l.widthClass === "expanded"} />
        <Row k="large" v="≥ 1200 dp" hi={l.widthClass === "large"} />
        <Text style={styles.hint}>
          Waydroid：dp = 像素 × 160 ÷ density（`sudo waydroid shell wm density`）。
          平台 {Platform.OS}。
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.vermilion,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  badgeText: {
    color: colors.paperRaised,
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 1,
  },
  section: {
    ...type.heading,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  k: {
    ...type.caption,
    flex: 1,
  },
  v: {
    ...type.body,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  vHi: {
    color: colors.vermilion,
    fontWeight: "700",
  },
  hint: {
    ...type.small,
    paddingBottom: spacing.sm,
  },
});
