/**
 * 冷启动恢复上次阅读位置。
 *
 * 在导航容器 ready、且 auth 会话恢复完成（用户作用域已确定）之后，
 * 若阅读设置里「恢复上次阅读位置」为开、且当前用户有阅读记录，就自动跳回
 * 上次的阅读页与段落（book / 视口顶部 paragraph / 版本 uid）。
 *
 * 冷启动带了显式链接（`Linking.getInitialURL()`）时让 `useDeepLinks` 优先，
 * auto 恢复不抢占。只做一次冷启动恢复，App 从后台回到前台不会重复触发。
 */
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { loadReaderSettings } from "../settings/reader";
import { loadReadingHistory } from "../data/history";
import { navigationRef } from "../linking/handler";
import { useAuth } from "../auth/AuthContext";

export function useRestoreLastReading(ready: boolean) {
  const { restoring } = useAuth();

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
