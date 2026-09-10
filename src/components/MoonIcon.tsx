/**
 * 月相图标 —— 按**真相位角**画明暗分界，不是四张固定图。
 *
 * RN 没有 `clip-path`，用经典的三层画法：一个 `overflow:hidden` 的圆里放
 * 左右两个半圆定出大势，再叠一个宽度随 |cos(相位)| 变化的椭圆补出终结线。
 * 相位角 0=朔、90=上弦、180=望、270=下弦。
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../theme";

interface Props {
  /** 0-360。 */
  angle: number;
  size?: number;
  /** 描边颜色；默认次文字色。 */
  border?: string;
}

export function MoonIcon({ angle, size = 16, border = colors.inkSoft }: Props) {
  const lit = colors.paperSunken;
  const dark = colors.ink;
  const phase = ((angle % 360) + 360) % 360;
  // 上半圈（0-180）亮面在右，下半圈亮面在左。
  const litOnRight = phase <= 180;
  const cos = Math.abs(Math.cos((phase * Math.PI) / 180));
  // 终结线椭圆：靠近朔望时退化成一条线（宽 0）或整圆（宽 = 直径）。
  const ellipseWidth = size * cos;
  const waxingHalf = phase < 90 || phase > 270; // 亮面不足一半
  const ellipseColor = waxingHalf ? dark : lit;

  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, borderColor: border },
      ]}
    >
      <View style={[styles.half, { backgroundColor: litOnRight ? dark : lit }]} />
      <View style={[styles.half, { backgroundColor: litOnRight ? lit : dark }]} />
      <View
        style={[
          styles.ellipse,
          {
            width: ellipseWidth,
            height: size,
            borderRadius: size / 2,
            marginLeft: -ellipseWidth / 2,
            backgroundColor: ellipseColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    flexDirection: "row",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  half: {
    flex: 1,
  },
  ellipse: {
    position: "absolute",
    left: "50%",
    top: 0,
  },
});
