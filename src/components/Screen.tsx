import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";
import { useLayout } from "../hooks/useLayout";

interface ScreenProps {
  children: React.ReactNode;
  /** 是否需要纵向滚动（默认 true）。 */
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * 关闭「限宽 + 居中」，让内容铺满容器（用于自己分配宽度的双栏页面，
   * 如阅读器对照、探索问答，见 `docs/README.md` §4.4）。
   */
  fullBleed?: boolean;
}

/**
 * 统一的纸面底色 + 安全区容器，并统一负责响应式限宽与居中（`docs/README.md` §4.4）。
 *
 * 宽屏下正文**居中限宽**，多出来的宽度留给边注 / 目录 / 对照栏，而不是把
 * 一行拉到整屏宽 —— 这是阅读类 App 与工具类 App 最大的分野。页面自身不关心断点。
 */
export function Screen({
  children,
  scroll = true,
  style,
  contentStyle,
  fullBleed = false,
}: ScreenProps) {
  const { maxContentWidth, gutter } = useLayout();

  const layoutStyle: ViewStyle = {
    paddingHorizontal: gutter,
    maxWidth: fullBleed ? undefined : maxContentWidth,
    width: "100%",
    alignSelf: "center",
  };

  const body = scroll ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, layoutStyle, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, layoutStyle, styles.flex, contentStyle]}>
      {children}
    </View>
  );

  // 顶部 inset 由导航头部（native header）处理，这里只留左右，
  // 避免有 header 的屏幕出现「双重顶部留白」。
  return (
    <SafeAreaView style={[styles.safe, style]} edges={["left", "right"]}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
