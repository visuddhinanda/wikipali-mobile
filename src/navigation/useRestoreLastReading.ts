/**
 * 冷启动恢复上次阅读位置。
 *
 * 规则（用户确认）：只有「退出时正好停留在阅读页」才自动回到阅读页 + 精确段落；
 * 从其它页面退出则不跳回阅读页（照常进默认首页）。阅读器自身的「继续上次读」
 * 由 `resolveStartParagraph` 负责，与本 hook 无关。
 *
 * 实现分两步：
 *  1. 写：App 转后台 / 失活（被系统清退前必经）时，记录「当前聚焦路由是不是 Reader」。
 *     只在退出时刻写，避免冷启动首帧（默认落在探索页）把标志覆盖成 false。
 *  2. 读：导航 ready 且 auth 会话恢复完成后，仅当「恢复上次阅读位置」开关开、
 *     退出时在阅读页、且当前用户有阅读记录，才跳回上次的 book / 视口顶部段落 / 版本。
 *
 * 显式外部链接（`Linking.getInitialURL()`）优先：auto 恢复不抢占 `useDeepLinks`。
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { loadReaderSettings } from "../settings/reader";
import { loadReadingHistory } from "../data/history";
import { navigationRef } from "../linking/handler";
import { useAuth } from "../auth/AuthContext";

const LAST_IN_READER_KEY = "@wikipali/last-in-reader";

async function setLastInReader(onReader: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_IN_READER_KEY, onReader ? "1" : "0");
  } catch {
    // 写入失败忽略：下次退出时会再写。
  }
}

async function loadLastInReader(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LAST_IN_READER_KEY)) === "1";
  } catch {
    return false;
  }
}

export function useRestoreLastReading(ready: boolean) {
  const { restoring } = useAuth();

  // 写：App 转后台 / 失活时记录「当前是否停在阅读页」。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        const onReader = navigationRef.getCurrentRoute()?.name === "Reader";
        void setLastInReader(onReader);
      }
    });
    return () => sub.remove();
  }, []);

  // 读：冷启动恢复。
  useEffect(() => {
    if (!ready || restoring) return;
    let cancelled = false;

    (async () => {
      // 先读设置（AsyncStorage，不触碰用户作用域）。本 effect 是 AuthProvider 的
      // 子组件 effect，会在父组件的 `setUserScope` effect **之前**同步执行；这里先
      // await 一下，等同一轮 commit 里父组件把作用域定好，随后 loadReadingHistory
      // 才会打开「当前用户」那份 reading.db3（guest / user）。
      const settings = await loadReaderSettings();
      if (cancelled || !settings.restoreLastReading) return;

      // 冷启动带了外部链接 → 交给 useDeepLinks，这里不抢占。
      const initialUrl = await Linking.getInitialURL();
      if (cancelled || initialUrl) return;

      // 只有「退出时停在阅读页」才恢复。
      if (!(await loadLastInReader())) return;

      const history = await loadReadingHistory();
      if (cancelled) return;
      const last = history[0];
      if (!last || !navigationRef.isReady()) return;

      // 分两步跳：先切到「探索」Tab，再让该 Tab 内部 Stack 打开 Reader。
      // 不用嵌套 navigate（`navigate("Discover", { screen: "Reader" })`），
      // Tab 路由与内层 Stack 首屏同名 "Discover"，嵌套 payload 会被吃掉
      // （同 `src/linking/handler.ts`）。
      navigationRef.navigate("Discover");
      setTimeout(() => {
        if (cancelled || !navigationRef.isReady()) return;
        navigationRef.navigate("Reader", {
          book: last.book,
          paragraph: last.paragraph,
          title: last.title,
          channelId: last.channelId,
        });
      }, 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, restoring]);
}
