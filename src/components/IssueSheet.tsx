/**
 * issue 标注弹层：阅读正文里点 `.anno-issue`（高亮原文）或句尾 `.anno-issue-mark`
 * （三角叹号）后弹出，逐条显示该处的 issue。
 *
 * 对齐桌面端 `resources/js/modules/issue-popover.js` 的展示口径，交互同百科词条
 * （`TermSheet.tsx`）：手机（compact）→ 底部抽屉；平板（medium 及以上）→ popover。
 * 一个标注可能合并了多条 issue（交叠的 issue 服务端已合成一个 span），所以是列表。
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchIssue, type Issue, type IssueSeverity } from "../api/discussion";
import { useT } from "../i18n/I18nContext";
import { readerColors, type ReaderChrome } from "../theme/reader";

/** 一次 issue 标注点击：ids 用于取内容，坐标用于平板 popover 定位（WebView 视口内）。 */
export interface IssueTap {
  ids: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

/** popover 卡片最大宽度。 */
const POPOVER_MAX_WIDTH = 300;
/** popover 卡片内容最大高度，超出滚动。 */
const POPOVER_MAX_HEIGHT = 360;

/**
 * severity 的颜色，与阅读 WebView 里 `.anno-issue-*` 的配色一致（ReaderLayerPane）：
 * error 红、warning 橙、suggestion 蓝；没有 severity 用淡墨色。
 */
export function issueColor(severity: IssueSeverity | null, dark: boolean): string | null {
  switch (severity) {
    case "error":
      return dark ? "#ef6b6b" : "#d63939";
    case "warning":
      return dark ? "#f5b041" : "#e67700";
    case "suggestion":
      return dark ? "#6cb2f0" : "#2f7ed8";
    default:
      return null;
  }
}

/** 一条 issue 的取数结果：null = 已不存在，Error = 取失败。 */
type IssueResult = Issue | null | Error;

/** 按 ids 并行取 issue。ids 变化 / 置空时重新取；组件卸载后丢弃过期结果。 */
function useIssues(ids: string[] | null): {
  items: IssueResult[];
  loading: boolean;
} {
  const [items, setItems] = useState<IssueResult[]>([]);
  const [loading, setLoading] = useState(false);
  const key = ids?.join(",") ?? "";

  useEffect(() => {
    if (!key) {
      setItems([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setItems([]);
    Promise.allSettled(key.split(",").map(fetchIssue)).then((results) => {
      if (!alive) return;
      setItems(
        results.map((r) =>
          r.status === "fulfilled"
            ? r.value
            : r.reason instanceof Error
              ? r.reason
              : new Error(String(r.reason)),
        ),
      );
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return { items, loading };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/** issue 列表正文：每条 = 三角图标 + 标题，正文，元信息（严重程度 · 作者 · 日期 · 回复数）。 */
function IssueList({
  items,
  loading,
  c,
  dark,
}: {
  items: IssueResult[];
  loading: boolean;
  c: ReaderChrome;
  dark: boolean;
}) {
  const t = useT();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.vermilion} />
      </View>
    );
  }

  return (
    <View>
      {items.map((item, i) => {
        const divider = i > 0 && [styles.divider, { borderTopColor: c.hairline }];
        if (item instanceof Error || item === null) {
          return (
            <View key={i} style={[styles.item, divider]}>
              <Text style={[styles.errorText, { color: c.inkFaint }]}>
                {item === null ? t("reader.issue.notFound") : t("common.loadFailed")}
              </Text>
            </View>
          );
        }
        const color = issueColor(item.severity, dark) ?? c.inkFaint;
        const meta = [
          item.severity ? t(`reader.issue.severity.${item.severity}`) : "",
          item.editor,
          formatDate(item.createdAt),
          item.replyCount > 0 ? t("reader.issue.replies", { n: item.replyCount }) : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <View key={item.id} style={[styles.item, divider]}>
            <View style={styles.itemHead}>
              <Ionicons name="warning-outline" size={16} color={color} />
              <Text style={[styles.itemTitle, { color: c.ink }]}>{item.title}</Text>
            </View>
            {item.summary ? (
              <Text style={[styles.itemBody, { color: c.inkSoft }]}>{item.summary}</Text>
            ) : null}
            {meta ? (
              <Text style={[styles.itemMeta, { color: c.inkFaint }]}>{meta}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** 手机：底部抽屉。 */
export function IssueDrawer({
  issue,
  dark,
  onClose,
}: {
  issue: IssueTap | null;
  dark: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const c = readerColors(dark);
  const insets = useSafeAreaInsets();
  const { items, loading } = useIssues(issue?.ids ?? null);

  return (
    <Modal
      transparent
      visible={issue != null}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.drawerRoot}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: c.backdrop }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.drawer,
            {
              backgroundColor: c.paperRaised,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>
          <View style={[styles.header, { borderBottomColor: c.hairline }]}>
            <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>
              {t("reader.issue.title")}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel={t("common.cancel")}
            >
              <Ionicons name="close" size={20} color={c.inkSoft} />
            </Pressable>
          </View>
          <ScrollView style={styles.drawerBody}>
            <IssueList items={items} loading={loading} c={c} dark={dark} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** 平板：锚定在标注附近的气泡 popover（由调用方放进 WebView 的容器里绝对定位）。 */
export function IssuePopover({
  issue,
  dark,
  containerWidth,
  containerHeight,
  onClose,
}: {
  issue: IssueTap;
  dark: boolean;
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
}) {
  const t = useT();
  const c = readerColors(dark);
  const { items, loading } = useIssues(issue.ids);

  const width = Math.max(200, Math.min(POPOVER_MAX_WIDTH, containerWidth - 16));
  const left = clamp(issue.x, 8, Math.max(8, containerWidth - width - 8));

  // 优先放在标注下方；放不下（贴容器底）就翻到上方。
  const below = issue.y + issue.h + 6;
  const top =
    below + 120 <= containerHeight - 8
      ? below
      : Math.max(8, issue.y - 6 - POPOVER_MAX_HEIGHT);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.popoverScrim} onPress={onClose} />
      <View
        style={[
          styles.popover,
          {
            left,
            top,
            width,
            backgroundColor: c.paperRaised,
            borderColor: c.border,
            shadowColor: "#000",
          },
        ]}
      >
        <View style={[styles.popoverHeader, { borderBottomColor: c.hairline }]}>
          <Text style={[styles.popoverTitle, { color: c.ink }]} numberOfLines={1}>
            {t("reader.issue.title")}
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={16} color={c.inkFaint} />
          </Pressable>
        </View>
        <ScrollView
          style={{ maxHeight: POPOVER_MAX_HEIGHT - 40 }}
          contentContainerStyle={styles.popoverBody}
          showsVerticalScrollIndicator={false}
        >
          <IssueList items={items} loading={loading} c={c} dark={dark} />
        </ScrollView>
      </View>
    </View>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    minHeight: 72,
  },
  errorText: {
    fontSize: 13,
  },
  item: {
    paddingVertical: 4,
  },
  divider: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  itemBody: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 21,
  },
  itemMeta: {
    marginTop: 4,
    fontSize: 12,
  },

  drawerRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  drawer: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "60%",
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 2,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  drawerBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  popoverScrim: {
    ...StyleSheet.absoluteFill,
  },
  popover: {
    position: "absolute",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  popoverHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  popoverTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  popoverBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
