import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * 纯 RN 环形进度条（不依赖 react-native-svg，避免引入原生模块）。
 *
 * 原理：用两个「半圆裁剪容器」各放一个带边框的整圆，每个圆的边框只在
 * 半圈上着色、另半圈透明，靠旋转把着色弧从 12 点方向顺时针扫出来。
 *   - 右半容器负责 0% → 50%，着色「上+右」两侧边框；
 *   - 左半容器负责 50% → 100%，着色「下+左」两侧边框。
 * 旋转角推导见实现内注释；中心可叠加百分比文字。
 */
interface ProgressRingProps {
  /** 进度，0 ~ 1。 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** 进度弧颜色。 */
  color?: string;
  /** 轨道（底环）颜色。 */
  trackColor?: string;
  /** 是否在中心显示百分比文字。 */
  showLabel?: boolean;
}

function formatProgress(p: number): string {
  if (p >= 0.995) return "100";
  const pct = p * 100;
  if (pct < 1) return `${pct.toFixed(1)}`;
  return `${Math.round(pct)}`;
}

/** 进度 0→1 映射到「红 → 琥珀 → 绿」渐变（常见进度条配色）。 */
function progressColor(p: number): string {
  const t = Math.min(1, Math.max(0, p));
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const f = t * 2;
    r = lerp(255, 250, f); // 红 → 琥珀
    g = lerp(77, 173, f);
    b = lerp(79, 20, f);
  } else {
    const f = (t - 0.5) * 2;
    r = lerp(250, 82, f); // 琥珀 → 绿
    g = lerp(173, 196, f);
    b = lerp(20, 26, f);
  }
  const to2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function ProgressRing({
  progress,
  size = 30,
  strokeWidth = 3,
  color,
  trackColor = "#d8cdb4",
  showLabel = true,
}: ProgressRingProps) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  // 未显式指定 color 时，按进度走「红→琥珀→绿」渐变。
  const arcColor = color ?? progressColor(p);
  const half = size / 2;

  // 每个半圆的旋转角（度）：
  //   着色弧空 → -135°，着色弧铺满该半圆 → 45°；两者之间线性插值。
  const rightDeg = p >= 0.5 ? 45 : -135 + 360 * p;
  const leftDeg = p <= 0.5 ? -135 : -135 + 360 * (p - 0.5);

  const ringBase = {
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: strokeWidth,
    position: "absolute" as const,
    top: 0,
  };

  return (
    <View style={{ width: size, height: size }}>
      {/* 轨道（整圈底环） */}
      <View style={[ringBase, { left: 0, borderColor: trackColor }]} />

      {/* 右半：0% → 50%，着色上+右 */}
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <View
          style={[
            ringBase,
            {
              left: -half,
              borderTopColor: arcColor,
              borderRightColor: arcColor,
              borderBottomColor: "transparent",
              borderLeftColor: "transparent",
              transform: [{ rotate: `${rightDeg}deg` }],
            },
          ]}
        />
      </View>

      {/* 左半：50% → 100%，着色下+左 */}
      <View style={[styles.clip, { left: 0, width: half, height: size }]}>
        <View
          style={[
            ringBase,
            {
              left: 0,
              borderTopColor: "transparent",
              borderRightColor: "transparent",
              borderBottomColor: arcColor,
              borderLeftColor: arcColor,
              transform: [{ rotate: `${leftDeg}deg` }],
            },
          ]}
        />
      </View>

      {/* 中心百分比 */}
      {showLabel ? (
        <View style={[styles.center, { width: size, height: size }]}>
          <Text style={[styles.label, { fontSize: Math.round(size * 0.26) }]}>
            {formatProgress(p)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: "#6b5f4e",
    fontWeight: "700",
  },
});
