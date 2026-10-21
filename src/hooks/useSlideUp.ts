/**
 * 底部抽屉的进场动画：面板从屏幕底部滑上来。
 *
 * 配合 `<Modal animationType="fade">` 用——遮罩随 Modal 原地淡入，只有面板平移。
 * 不用 `animationType="slide"`：那会让遮罩跟着面板一起从底部滑上来，遮罩的上边缘
 * 扫过整屏正文，看起来像屏幕在抖（阅读页 issue / 词条抽屉曾经如此）。
 * 关闭时不做反向动画，面板随 Modal 一起淡出。
 *
 * 用法：`const translateY = useSlideUp(visible);`，把它放进面板 `Animated.View` 的
 * `transform: [{ translateY }]`。
 */
import { useEffect, useRef } from "react";
import { Animated, useWindowDimensions } from "react-native";

const DURATION_MS = 220;

export function useSlideUp(visible: boolean): Animated.Value {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(height);
    Animated.timing(translateY, {
      toValue: 0,
      duration: DURATION_MS,
      useNativeDriver: true,
    }).start();
  }, [visible, height, translateY]);

  return translateY;
}
