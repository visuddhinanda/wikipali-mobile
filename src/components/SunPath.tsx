/**
 * 当日太阳高度曲线。
 *
 * 曲线是**算出来的**：从当地 0 点到 24 点逐点求太阳高度角，按高度画柱。
 * 没有用 SVG —— 这个 App 没装 `react-native-svg`，为一张图加原生依赖不值得，
 * 一排细柱同样能把「日出多陡、正午多高、白昼多长」说清楚。
 *
 * 地平线以下的部分画在基线之下并压暗，明相与日落两条阈值线标出来，
 * 极昼极夜时曲线整条在基线一侧 —— 那本身就是答案。
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { sunAltitude, type GeoPoint } from "../calendar/astro";
import { zonedDayStart } from "../calendar/tz";

interface Props {
  place: GeoPoint & { timeZone: string };
  year: number;
  month: number;
  day: number;
  /** 明相 / 日落等标记的当地小时（0-24 的小数），用来画竖直标线。 */
  markers?: { hour: number; color: string }[];
  height?: number;
}

/** 采样点数：15 分钟一个，足够平滑，算 96 次高度角约几毫秒。 */
const SAMPLES = 96;

export function SunPath({ place, year, month, day, markers = [], height = 96 }: Props) {
  const samples = useMemo(() => {
    const start = zonedDayStart(year, month, day, place.timeZone).getTime();
    const step = 86400_000 / SAMPLES;
    return Array.from({ length: SAMPLES }, (_, i) =>
      sunAltitude(place, new Date(start + i * step)),
    );
  }, [place.lat, place.lon, place.timeZone, year, month, day]);

  const max = Math.max(10, ...samples);
  const min = Math.min(-10, ...samples);
  const span = max - min;
  // 地平线在图中的位置（从底部往上量）。
  const horizon = ((0 - min) / span) * height;

  return (
    <View style={styles.wrap}>
      <View style={[styles.plot, { height }]}>
        <View style={[styles.horizon, { bottom: horizon }]} />
        {samples.map((altitude, i) => {
          const y = ((altitude - min) / span) * height;
          const above = altitude >= 0;
          return (
            <View key={i} style={styles.slot}>
              <View
                style={[
                  styles.bar,
                  above
                    ? { bottom: horizon, height: Math.max(1, y - horizon) }
                    : { bottom: y, height: Math.max(1, horizon - y) },
                  { backgroundColor: above ? colors.ochre : colors.border },
                ]}
              />
            </View>
          );
        })}
        {markers.map((marker, i) => (
          <View
            key={`m${i}`}
            style={[
              styles.marker,
              { left: `${(marker.hour / 24) * 100}%`, backgroundColor: marker.color },
            ]}
          />
        ))}
      </View>
      <View style={styles.axis}>
        {["0", "6", "12", "18", "24"].map((label) => (
          <Text key={label} style={styles.axisLabel}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  plot: { flexDirection: "row", alignItems: "flex-end", position: "relative" },
  horizon: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  slot: { flex: 1, height: "100%" },
  bar: { position: "absolute", left: 0, right: 0.5 },
  marker: { position: "absolute", top: 0, bottom: 0, width: 1, opacity: 0.7 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  axisLabel: { fontSize: 9, color: colors.inkFaint },
});
