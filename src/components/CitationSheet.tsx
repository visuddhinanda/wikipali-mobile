import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getBookChannels } from "../api";
import { loadOnePara } from "../reading";
import type { ChapterChannel } from "../catalog";
import { useT } from "../i18n/I18nContext";
import { colors, radius, spacing, type } from "../theme";

/** 一次引用的坐标（点击 AI 回答里的 wikipali 引用链接得到）。 */
export interface CitationTarget {
  book: number;
  paragraph: number;
  /** 链接里的 channel 参数：`translation` 是「找译文」占位符，其余为具体版本 uid。 */
  channel?: string;
}

/** 兜底版本：巴利原文（与阅读器 FALLBACK_CHANNEL_NAME 一致）。 */
const PALI_VRI = "_System_Pali_VRI_";

function isPaliOriginal(c: ChapterChannel): boolean {
  return c.type === "original" || c.name === PALI_VRI;
}

/** 把一段正文 HTML 包成极简阅读样式（暖米黄纸感 + 衬线，与阅读器同一套观感）。 */
function buildHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --paper:#f7f3ea; --ink:#3a3128; --ink-soft:#6b5f4e; --vermilion:#8c3b2e; --hairline:#e4dbc6; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); }
  body {
    font-family: Georgia, "Songti SC", "Noto Serif SC", "Noto Sans Myanmar",
      "Noto Sans Sinhala", "Noto Sans Thai", serif;
    font-size: 17px;
    line-height: 1.9;
    overflow-wrap: break-word;
    word-break: break-word;
    -webkit-text-size-adjust: 100%;
    padding: 8px 4px 16px;
  }
  .original, .translation { margin: 0 0 0.55em; }
  .sentence { display: inline; }
  .sentence + .sentence::before { content: " "; }
  strong, b { font-weight: 700; }
  em, i { font-style: italic; }
  h1, h2, h3, h4, h5, h6 { font-weight: 700; line-height: 1.4; margin: 0.55em 0 0.25em; }
  h1 { font-size: 1.2em; } h2 { font-size: 1.15em; } h3 { font-size: 1.1em; }
  h4 { font-size: 1.05em; } h5, h6 { font-size: 1em; }
  code { font-family: inherit; color: var(--vermilion); font-size: 0.7em; vertical-align: super; margin: 0 1px; }
  ol, ul { margin: 0.25em 0; padding-left: 1.5em; }
  li { margin: 0.15em 0; }
  blockquote { margin: 0.5em 0; padding-left: 0.8em; border-left: 2px solid var(--hairline); color: var(--ink-soft); }
  a { color: var(--vermilion); text-decoration: none; }
  hr { border: none; border-top: 1px solid var(--hairline); margin: 1em 0; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid var(--hairline); padding: 4px 8px; }
</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * 引用内容底部面板：点击 AI 回答里的引用链接时，从下方拉出并展示对应段落。
 *
 * 展示策略：链接带具体版本就取该版本；否则译文优先，没有译文回退到
 * 巴利原文 `_System_Pali_VRI_`。
 */
export function CitationSheet({
  target,
  onClose,
}: {
  target: CitationTarget | null;
  onClose: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  /** 展示名：译文版本名，或「巴利原文」；空串表示未知，不显示标签。 */
  const [label, setLabel] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setLoading(true);
    setHtml(null);
    setLabel("");
    setError(false);

    (async () => {
      let list: ChapterChannel[] = [];
      try {
        list = await getBookChannels(target.book, target.paragraph);
      } catch {
        list = [];
      }

      let channelId: string;
      let channelName = "";

      if (target.channel && target.channel !== "translation") {
        // 链接里带具体版本 uid → 直接用；从列表里找回显示名。
        channelId = target.channel;
        const hit = list.find((c) => c.channel_id === target.channel);
        if (hit) channelName = isPaliOriginal(hit) ? "" : hit.name;
      } else {
        // 译文优先，没有译文回退巴利原文。
        const translation = list.find((c) => c.type === "translation");
        const pali =
          list.find((c) => c.name === PALI_VRI) ??
          list.find((c) => c.type === "original");
        const picked = translation ?? pali;
        if (picked) {
          channelId = picked.channel_id;
          channelName = isPaliOriginal(picked) ? "" : picked.name;
        } else {
          // 版本列表拿不到时，直接按巴利原文频道取正文。
          channelId = PALI_VRI;
        }
      }

      try {
        // 走阅读链路的缓存（`src/reading/cache.ts`）：该版本没有这一段、
        // 或离线取不到，都回 null —— 离线占位文不能冒充真经显示出去。
        const body = await loadOnePara(channelId, target.book, target.paragraph);
        if (!alive) return;
        if (!body) {
          setError(true);
          return;
        }
        setHtml(body);
        setLabel(channelName);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [target]);

  const visible = target != null;
  const ref = target ? `${target.book}-${target.paragraph}` : "";
  const badge = label || t("chat.paliOriginal");

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Ionicons name="book-outline" size={18} color={colors.vermilion} />
            <Text style={styles.title} numberOfLines={1}>
              {ref}
            </Text>
            {badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText} numberOfLines={1}>
                  {badge}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel={t("common.cancel")}
              style={styles.close}
            >
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.vermilion} />
              </View>
            ) : error || !html ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>
                  {t("error.noOnlineContent")}
                </Text>
              </View>
            ) : (
              <WebView
                originWhitelist={["*"]}
                source={{ html: buildHtml(html) }}
                style={styles.webview}
                setSupportMultipleWindows={false}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(58, 49, 40, 0.35)",
  },
  sheet: {
    maxHeight: "72%",
    minHeight: 240,
    backgroundColor: colors.paperRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  title: {
    ...type.heading,
    color: colors.ink,
    flexShrink: 1,
  },
  badge: {
    flexShrink: 1,
    maxWidth: "50%",
    backgroundColor: colors.paperSunken,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    ...type.small,
    color: colors.inkSoft,
  },
  close: {
    marginLeft: "auto",
    padding: spacing.xs,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 160,
  },
  emptyText: {
    ...type.body,
    color: colors.inkFaint,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.paperRaised,
  },
});
