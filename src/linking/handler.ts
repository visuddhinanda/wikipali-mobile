/**
 * 外部链接的接管：冷启动的 initial URL、运行中收到的 `Linking` 事件，
 * 以及扫码得到的字符串，最终都汇到 `openWikipaliUrl`。
 *
 * 不用 React Navigation 的 `linking` 配置：路径 → 路由参数不是一一对应
 * （书名要按 `book-para` 反查 `book-titles.json`），手写解析更直白。
 */
import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { parseWikipaliUrl, readerRouteParams } from "./wikipali-url";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * 打开一条 WikiPali 链接。
 * @returns 认得并已跳转返回 `true`；认不出返回 `false`。
 */
export function openWikipaliUrl(url: string): boolean {
  const target = parseWikipaliUrl(url);
  if (!target || !navigationRef.isReady()) return false;

  if (target.kind === "reader") {
    // 分两步跳：先切到「分类」Tab，再让该 Tab 内部的 Stack 打开 Reader。
    // 不用 `navigate("Discover", { screen: "Reader" })` 这种嵌套写法 ——
    // Tab 路由与 BrowseStack 首屏同名 "Discover"，嵌套 payload 会被吃掉，
    // 真机上表现为「日志走到了、界面纹丝不动」。
    const go = navigationRef.navigate as (name: string, params?: unknown) => void;
    go("Discover");
    setTimeout(() => go("Reader", readerRouteParams(target)), 0);
    return true;
  }

  return false;
}
