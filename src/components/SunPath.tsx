/**
 * 当日太阳高度曲线。
 *
 * 太阳高度角是解析式 `sin h = sin φ·sin δ + cos φ·cos δ·cos H`（NOAA 太阳位置
 * 计算）。时角 H 随时间线性增长，所以 h 处处连续可导 —— 它**是一条平滑曲线，
 * 没有折点**，画出来也必须是曲线。
 *
 * 平滑靠的是**插值函数，不是采样点数量**：取 `SAMPLES` 个真实高度角，中间用
 * Catmull-Rom 样条（C¹ 连续，过每一个采样点）求值。样条一上，十来个点和一百个
 * 点画出来没有分别，所以采样点只需够描出形状，加密没有意义。
 *
 * 没有用 SVG：这个 App 没装 `react-native-svg`，为一张图加原生依赖不值得。
 * 曲线由样条求值出的折线画成，每段一个 `View`，**用 `rotate` 转到该段的斜率上**。
 * 轴对齐的矩形在陡处必然露出台阶（`onLayout` 给的是 DP 不是物理像素，3x 屏上
 * 每「列」有三个物理像素宽，台阶更明显）；转过的矩形边跟着曲线走，没有台阶，
 * 线宽也是**垂直于曲线**量的，不会在陡段被压细 cos θ 倍。两端加圆角当线帽。
 *
 * 纵轴取当天真实的 [min, max]，**不做任何截断**。早先为了把明相推离地平线，
 * 我把下界钉在 −18°，结果夜里真实的 −78° 那一大段被压成一条死平的底线，两头
 * 各留一个硬折角 —— 那个假平底才是「看起来像折线」的主因，不是采样点不够。
 *
 * 还有一件事值得记下来：**近赤道的分日，这条曲线本来就接近直线**。北纬 6.7°
 * 秋分前后，太阳以约 14.9°/小时一路直上，从日出到日中几乎是一条斜线；同一天
 * 放到北纬 40°，9 点的高度是 36° 而线性外推只有 27°，那才是圆弧。图直不直是
 * 纬度和节气决定的，不是画错了。
 *
 * 曲线上下同色、粗细一致，不填充 —— 地平线由那条横线交代，不靠明暗。
 */
import React, { useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { sunAltitude, type GeoPoint } from "../calendar/astro";
import { zonedDayStart } from "../calendar/tz";

/** 曲线上的一个关键时刻。样式与标签位置由 `kind` 决定，调用方不用操心画法。 */
export interface SunMark {
  /** 当地小时，0-24 的小数。 */
  hour: number;
  /** 显示的时刻，如 `05:35`。 */
  label: string;
  /** 只有日中带名字，写在时刻后面。 */
  name?: string;
  /**
   * - `threshold` 明相 / 日暮：地平线之下的阈值时刻，空心环。
   * - `horizon` 日出 / 日没：太阳正在地平线上，实心赭点。
   * - `peak` 日中：太阳上中天，实心朱砂点，画得大一点。
   */
  kind: "threshold" | "horizon" | "peak";
}

interface Props {
  place: GeoPoint & { timeZone: string };
  year: number;
  month: number;
  day: number;
  marks?: SunMark[];
  height?: number;
}

/** 上下留出的余量（度），免得日中的圆点和它的标签顶到边上。 */
const HEADROOM = 4;
/** 曲线粗细（垂直于曲线量）。 */
const STROKE = 2.5;
/** 真实采样点数：半小时一个。平滑由样条负责，采样点不需要多。 */
const SAMPLES = 48;
/** 绘制段数：样条求值出来的折线段数。 */
const SEGMENTS = 120;

const DOT = { threshold: 8, horizon: 7, peak: 9 } as const;
const LABEL_W = 60;
const LABEL_NAMED_W = 96;
const LABEL_GAP = 3;
const LABEL_H = 15;

/**
 * 均匀节点的 Catmull-Rom 样条，按下标 `t` 求值。
 * 端点各自复制一份当作虚拟控制点，曲线仍然过首尾。
 */
function catmullRom(ys: number[], t: number): number {
  const n = ys.length - 1;
  const i = Math.max(0, Math.min(n - 1, Math.floor(t)));
  const u = t - i;
  const p0 = ys[Math.max(0, i - 1)];
  const p1 = ys[i];
  const p2 = ys[Math.min(n, i + 1)];
  const p3 = ys[Math.min(n, i + 2)];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  );
}

export function SunPath({ place, year, month, day, marks = [], height = 132 }: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const samples = useMemo(() => {
    const start = zonedDayStart(year, month, day, place.timeZone).getTime();
    return Array.from({ length: SAMPLES + 1 }, (_, i) =>
      sunAltitude(place, new Date(start + (i / SAMPLES) * 86400_000)),
    );
  }, [place.lat, place.lon, place.timeZone, year, month, day]);

  /** 当天真实的高度角范围，上下各留一点余量。不截断。 */
  const lo = Math.min(...samples) - HEADROOM;
  const hi = Math.max(...samples) + HEADROOM;
  const span = Math.max(1, hi - lo);
  /** 高度角 → 离**顶边**的距离。 */
  const yOf = (altitude: number) =>
    ((hi - altitude) / span) * (height - STROKE) + STROKE / 2;
  const horizon = yOf(0);

  /** 曲线上任意当地小时处的纵坐标 —— 圆点靠它落在曲线上，不另算一次高度角。 */
  const yAtHour = (hour: number) => yOf(catmullRom(samples, (hour / 24) * SAMPLES));

  const step = width / SEGMENTS;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={[styles.plot, { height }]}>
        <View style={[styles.horizon, { top: horizon }]} />

        {width
          ? Array.from({ length: SEGMENTS }, (_, i) => {
              const y1 = yOf(catmullRom(samples, (i / SEGMENTS) * SAMPLES));
              const y2 = yOf(catmullRom(samples, ((i + 1) / SEGMENTS) * SAMPLES));
              const dy = y2 - y1;
              // 段长取斜边，再绕自身中心转到该段的斜率上。两端各探出半个线宽，
              // 让相邻两段的圆角线帽叠在一起，接缝看不出来。
              const len = Math.hypot(step, dy) + STROKE;
              return (
                <View
                  key={i}
                  style={[
                    styles.stroke,
                    {
                      width: len,
                      left: i * step + step / 2 - len / 2,
                      top: y1 + dy / 2 - STROKE / 2,
                      transform: [{ rotate: `${Math.atan2(dy, step)}rad` }],
                    },
                  ]}
                />
              );
            })
          : null}

        {width
          ? marks.map((mark, i) => {
              const size = DOT[mark.kind];
              const x = (mark.hour / 24) * width;
              const y = yAtHour(mark.hour);
              const w = mark.name ? LABEL_NAMED_W : LABEL_W;
              // 明相与日出只差二十几分钟，两个点几乎叠在一起，标签必须**上下加左右**
              // 都岔开：阈值时刻（明相 / 日暮）的标签在点上方，升没（日出 / 日没）
              // 在下方；再把上午那一对往左推、下午那一对往右推，各自贴着自己的点。
              const above = mark.kind !== "horizon";
              const morning = mark.hour < 12;
              const left = mark.name
                ? x - w / 2 // 日中居中
                : morning === above
                  ? x - w - LABEL_GAP // 标签在点的左边
                  : x + LABEL_GAP; // 标签在点的右边
              return (
                <React.Fragment key={`${mark.kind}${i}`}>
                  <View
                    style={[
                      styles.dot,
                      {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        left: x - size / 2,
                        top: y - size / 2,
                      },
                      mark.kind === "threshold" && styles.dotHollow,
                      mark.kind === "horizon" && styles.dotHorizon,
                      mark.kind === "peak" && styles.dotPeak,
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      mark.name ? styles.labelCenter : morning === above ? styles.labelRight : styles.labelLeft,
                      {
                        width: w,
                        left: Math.max(0, Math.min(width - w, left)),
                        top: above
                          ? y - size / 2 - LABEL_GAP - LABEL_H
                          : y + size / 2 + LABEL_GAP,
                      },
                    ]}
                  >
                    {mark.name ? `${mark.label}  ${mark.name}` : mark.label}
                  </Text>
                </React.Fragment>
              );
            })
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
  },
  plot: { position: "relative" },
  horizon: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  stroke: {
    position: "absolute",
    height: STROKE,
    borderRadius: STROKE / 2,
    backgroundColor: colors.ochre,
  },
  dot: { position: "absolute" },
  dotHollow: {
    backgroundColor: colors.paperSunken,
    borderWidth: 1.5,
    borderColor: colors.inkSoft,
  },
  dotHorizon: { backgroundColor: colors.ochre },
  dotPeak: { backgroundColor: colors.vermilion },
  label: {
    position: "absolute",
    fontSize: 11,
    lineHeight: LABEL_H,
    color: colors.inkFaint,
  },
  labelCenter: { textAlign: "center" },
  labelLeft: { textAlign: "left" },
  labelRight: { textAlign: "right" },
});
