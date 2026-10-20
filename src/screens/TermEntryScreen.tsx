/**
 * 百科词条详情页。
 *
 * 从阅读器抽屉 / popover 的「阅读条目」进入，按 guid 取
 * `GET /v2/terms/{guid}`，正文用返回的 `html` 字段渲染；
 * 头部展示 word（巴利原词，斜体）+ meaning（释义），底部展示编辑者与更新时间。
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fetchTerm, type TermEntry } from "../api/term";
import { useT } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "TermEntry">;

/** 词条正文 HTML → 一张自包含的阅读页（暖米黄纸感 + 衬线，与阅读器同观感）。 */
function buildEntryHtml(entry: TermEntry, editorLabel: string, updatedLabel: string): string {
  const word = escapeHtml(entry.word);
  const meaning = escapeHtml(entry.meaning);

  const editorName = entry.editor?.nickName || entry.editor?.realName || "";
  const updated = (entry.updated_at ?? entry.created_at ?? "").slice(0, 10);
  const metaParts: string[] = [];
  if (editorName) metaParts.push(`${escapeHtml(editorLabel)}：${escapeHtml(editorName)}`);
  if (updated) metaParts.push(`${escapeHtml(updatedLabel)}：${escapeHtml(updated)}`);
  const meta = metaParts.join(" · ");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --paper:#f7f3ea; --ink:#3a3128; --ink-soft:#6b5f4e; --ink-faint:#9a8c76; --vermilion:#8c3b2e; --hairline:#e4dbc6; }
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
  }
  .page { max-width: 720px; margin: 0 auto; padding: 20px 18px 48px; }

  .entry-head { padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid var(--hairline); }
  .entry-word {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 26px;
    font-weight: 600;
    color: var(--vermilion);
  }
  .entry-meaning { font-size: 17px; font-weight: 600; margin-top: 2px; }

  .entry-body { }
  .entry-body p { margin: 0 0 1em; }
  .entry-body h1, .entry-body h2, .entry-body h3, .entry-body h4, .entry-body h5, .entry-body h6 {
    font-weight: 600; line-height: 1.35; margin: 1.4em 0 0.5em; color: var(--ink);
  }
  .entry-body h1 { font-size: 1.3em; border-bottom: 1px solid var(--hairline); padding-bottom: 0.3em; }
  .entry-body h2 { font-size: 1.18em; border-bottom: 1px solid var(--hairline); padding-bottom: 0.3em; }
  .entry-body h3 { font-size: 1.05em; }
  .entry-body h4, .entry-body h5, .entry-body h6 { font-size: 0.95em; color: var(--ink-soft); }
  .entry-body strong, .entry-body b { font-weight: 700; }
  .entry-body em, .entry-body i { font-style: italic; }
  .entry-body a { color: var(--vermilion); text-decoration: none; border-bottom: 1px solid transparent; }
  .entry-body a:hover { border-bottom-color: var(--vermilion); }
  .entry-body ul, .entry-body ol { padding-left: 1.5em; margin: 0 0 1em; }
  .entry-body li { margin: 0.2em 0; }
  .entry-body blockquote {
    margin: 1em 0; padding: 10px 16px; border-left: 3px solid var(--hairline);
    background: rgba(0,0,0,0.03); color: var(--ink-soft);
  }
  .entry-body table { border-collapse: collapse; width: 100%; margin: 0 0 1.2em; font-size: 0.92em; }
  .entry-body th, .entry-body td { border: 1px solid var(--hairline); padding: 6px 10px; text-align: left; }
  .entry-body th { background: rgba(0,0,0,0.03); color: var(--ink-soft); font-weight: 600; }
  .entry-body code {
    font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85em;
    background: rgba(0,0,0,0.05); border-radius: 4px; padding: 1px 5px;
  }
  .entry-body img { max-width: 100%; height: auto; border-radius: 6px; }
  .entry-body hr { border: none; border-top: 1px solid var(--hairline); margin: 1.5em 0; }
  .entry-body .term-ref { text-decoration: underline; text-underline-offset: 0.15em; cursor: pointer; }

  .entry-meta {
    margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--hairline);
    font-size: 13px; color: var(--ink-faint);
  }
</style>
</head>
<body>
  <div class="page">
    <div class="entry-head">
      <div class="entry-word">${word}</div>
      <div class="entry-meaning">${meaning}</div>
    </div>
    <div class="entry-body">${entry.html}</div>
    ${meta ? `<div class="entry-meta">${meta}</div>` : ""}
  </div>
</body>
</html>`;
}

/** HTML 转义（word / meaning / 元信息当文本塞进 HTML 前用）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function TermEntryScreen({ route, navigation }: Props) {
  const t = useT();
  const { guid } = route.params;

  const [entry, setEntry] = useState<TermEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setEntry(null);
    fetchTerm(guid)
      .then((d) => {
        if (!alive) return;
        setEntry(d);
        navigation.setOptions({
          title: d.meaning || d.word || t("term.entry"),
        });
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guid, navigation]);

  const html = useMemo(
    () =>
      entry
        ? buildEntryHtml(entry, t("term.editor"), t("term.updatedAt"))
        : "",
    [entry, t],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.vermilion} />
      </View>
    );
  }
  if (error || !entry) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline" size={36} color={colors.inkFaint} />
        <Text style={styles.errorText}>{t("common.loadFailed")}</Text>
      </View>
    );
  }

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      style={styles.web}
      setSupportMultipleWindows={false}
      javaScriptEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.paper,
  },
  errorText: {
    fontSize: 13,
    color: colors.inkSoft,
  },
  web: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
