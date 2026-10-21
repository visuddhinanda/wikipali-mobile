/**
 * 百科词条弹层：阅读正文里点 `.term-ref`（如「沙瓦提」）后弹出。
 *
 * 对齐桌面端 `resources/js/modules/term-tooltip.js` + `wiki.css` 的展示口径：
 *   - 词条样式（斜体 + 点线下划线 + 链接色）在阅读 WebView 里做（ReaderLayerPane）；
 *   - 点击反应按设备分两档：
 *       · 手机（compact）→ 底部抽屉（`TermDrawer`，对应桌面 Offcanvas bottom）；
 *       · 平板（medium 及以上）→ popover（`TermPopover`，对应桌面 Bootstrap popover）。
 *
 * 内容都取 `word`（巴利原词，斜体）+ `meaning`（释义）+ `summary`（摘要），
 * 与桌面 `buildPopoverContent` / `fillMobileDrawer` 一致。
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchTerm, type TermEntry } from "../api/term";
import { useT } from "../i18n/I18nContext";
import { useSlideUp } from "../hooks/useSlideUp";
import { serifFont } from "../theme";
import { readerColors, type ReaderChrome } from "../theme/reader";

/** 一次词条点击：id 用于查词条，坐标用于平板 popover 定位（WebView 视口内）。 */
export interface TermTap {
  id: string;
  /** 行内原文（服务端 data-term），供调试；展示以接口返回的 word 为准。 */
  term: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 「阅读条目」跳转回调：guid + 标题（释义）。 */
type OpenEntryHandler = (guid: string, title: string) => void;

/** popover 卡片最大宽度（对齐桌面 wiki-term-popover 的 280px）。 */
const POPOVER_MAX_WIDTH = 280;
/** popover 卡片内容最大高度，超出滚动。 */
const POPOVER_MAX_HEIGHT = 320;

/** 按 guid 取词条。id 变化 / 置空时重新取；组件卸载后丢弃过期结果。 */
function useTermEntry(id: string | null): {
  data: TermEntry | null;
  loading: boolean;
  error: boolean;
} {
  const [data, setData] = useState<TermEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) {
      setData(null);
      setLoading(false);
      setError(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    setData(null);
    fetchTerm(id)
      .then((entry) => {
        if (alive) setData(entry);
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
  }, [id]);

  return { data, loading, error };
}

/** 词条卡片正文：word（斜体）+ meaning + summary，与桌面 popover 同一套。 */
function TermCard({
  data,
  loading,
  error,
  c,
}: {
  data: TermEntry | null;
  loading: boolean;
  error: boolean;
  c: ReaderChrome;
}) {
  const t = useT();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.vermilion} />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={[styles.errorText, { color: c.inkFaint }]}>
          {t("common.loadFailed")}
        </Text>
      </View>
    );
  }

  const word = data.word.trim();
  const meaning = data.meaning.trim();
  const summary = data.summary.trim();
  const showSummary = summary && summary !== meaning && summary !== word;

  return (
    <View>
      {word ? (
        <Text style={[styles.word, { color: c.vermilion }]}>{word}</Text>
      ) : null}
      {showSummary ? (
        <Text style={[styles.summary, { color: c.inkSoft }]}>{summary}</Text>
      ) : null}
    </View>
  );
}

/** 卡片底部的「阅读条目」链接风格按钮。 */
function ReadEntryLink({
  label,
  c,
  onPress,
}: {
  label: string;
  c: ReaderChrome;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.readEntry, pressed && { opacity: 0.6 }]}
      onPress={onPress}
      hitSlop={6}
    >
      <Text style={[styles.readEntryText, { color: c.vermilion }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={c.vermilion} />
    </Pressable>
  );
}

/** 手机：底部抽屉。 */
export function TermDrawer({
  term,
  dark,
  onClose,
  onOpenEntry,
}: {
  term: TermTap | null;
  dark: boolean;
  onClose: () => void;
  onOpenEntry?: OpenEntryHandler;
}) {
  const t = useT();
  const c = readerColors(dark);
  const insets = useSafeAreaInsets();
  const translateY = useSlideUp(term != null);
  const { data, loading, error } = useTermEntry(term?.id ?? null);
  const visible = term != null;
  const title = data?.meaning?.trim() ?? "";

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.drawerRoot}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: c.backdrop }]}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.drawer,
            {
              backgroundColor: c.paperRaised,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>
          <View style={[styles.header, { borderBottomColor: c.hairline }]}>
            <Text
              style={[styles.headerTitle, { color: c.ink }]}
              numberOfLines={1}
            >
              {title}
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
            <TermCard data={data} loading={loading} error={error} c={c} />
            {term && data && onOpenEntry ? (
              <ReadEntryLink
                label={t("reader.readEntry")}
                c={c}
                onPress={() =>
                  onOpenEntry(term.id, data.meaning || data.word)
                }
              />
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** 平板：锚定在词条附近的气泡 popover（由调用方放进 WebView 的容器里绝对定位）。 */
export function TermPopover({
  term,
  dark,
  containerWidth,
  containerHeight,
  onClose,
  onOpenEntry,
}: {
  term: TermTap;
  dark: boolean;
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
  onOpenEntry?: OpenEntryHandler;
}) {
  const t = useT();
  const c = readerColors(dark);
  const { data, loading, error } = useTermEntry(term.id);
  const title = data?.meaning?.trim() ?? "";

  const width = Math.max(200, Math.min(POPOVER_MAX_WIDTH, containerWidth - 16));
  const left = clamp(term.x, 8, Math.max(8, containerWidth - width - 8));

  // 优先放在词条下方；放不下（贴容器底）就翻到上方。
  const below = term.y + term.h + 6;
  const top =
    below + 120 <= containerHeight - 8
      ? below
      : Math.max(8, term.y - 6 - POPOVER_MAX_HEIGHT);

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
          <Text
            style={[styles.popoverTitle, { color: c.ink }]}
            numberOfLines={1}
          >
            {title}
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
          <TermCard data={data} loading={loading} error={error} c={c} />
          {data && onOpenEntry ? (
            <ReadEntryLink
              label={t("reader.readEntry")}
              c={c}
              onPress={() => onOpenEntry(term.id, data.meaning || data.word)}
            />
          ) : null}
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
  word: {
    fontFamily: serifFont,
    fontStyle: "italic",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 6,
  },
  summary: {
    fontSize: 14,
    lineHeight: 21,
  },
  readEntry: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 12,
  },
  readEntryText: {
    fontSize: 14,
    textDecorationLine: "underline",
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
