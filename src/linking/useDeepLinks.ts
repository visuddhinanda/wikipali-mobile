import { useEffect } from "react";
import * as Linking from "expo-linking";
import useShareIntent from "expo-share-intent/build/useShareIntent";
import { openWikipaliUrl } from "./handler";

/** 从分享内容里挑出第一条像链接的字符串。 */
function urlFromShared(text: string | null | undefined): string | null {
  if (!text) return null;
  // 分享文本常带一段说明（「…… https://next.wikipali.org/… 」），把链接抠出来。
  const m = /(https?:\/\/\S+|wikipali:\/\/\S+)/i.exec(text);
  return m ? m[1] : null;
}

/**
 * 接管外部进来的链接：
 *   1. 浏览器/其他 App 直接打开链接（ACTION_VIEW / universal link）→ `expo-linking`
 *   2. 其他 App「分享」链接给 WikiPali（ACTION_SEND）→ `expo-share-intent`
 *
 * 冷启动时导航容器可能还没 ready，所以要等 `ready` 为真再处理。
 */
export function useDeepLinks(ready: boolean) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void Linking.getInitialURL().then((url) => {
      if (!cancelled && url) openWikipaliUrl(url);
    });

    const sub = Linking.addEventListener("url", ({ url }) => {
      openWikipaliUrl(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !hasShareIntent) return;
    const url = shareIntent.webUrl ?? urlFromShared(shareIntent.text);
    if (url) openWikipaliUrl(url);
    resetShareIntent();
  }, [ready, hasShareIntent, shareIntent, resetShareIntent]);
}
