/**
 * 阅读器目录抽屉（右侧滑出）：展示当前书的章节树。
 *
 * - 默认只显示第一层级；
 * - 打开时自动展开当前章节的所有父层级，并高亮当前章节标题；
 * - 点目录项跳转到该章节；点左侧箭头展开/收起。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  ancestorParagraphs,
  findNode,
  getBookTree,
  type HeadingNode,
} from "../catalog/headings";
import { serifFont } from "../theme";
import { readerColors, type ReaderChrome } from "../theme/reader";

interface Props {
  visible: boolean;
  book: number;
  currentParagraph: number;
  dark: boolean;
  onClose: () => void;
  onSelect: (book: number, paragraph: number) => void;
}

interface Row {
  key: string;
  node: HeadingNode;
  depth: number;
}

export function ChapterDrawer({
  visible,
  book,
  currentParagraph,
  dark,
  onClose,
  onSelect,
}: Props) {
  const c = readerColors(dark);
  const { width } = useWindowDimensions();
  const panelW = Math.min(width * 0.84, 360);

  const slide = useRef(new Animated.Value(panelW)).current;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const roots = useMemo(() => getBookTree(book), [book]);

  useEffect(() => {
    if (!visible) return;
    const node = findNode(book, currentParagraph);
    setExpanded(new Set(ancestorParagraphs(node)));
    slide.setValue(panelW);
    Animated.timing(slide, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, book, currentParagraph, panelW, slide]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const walk = (nodes: HeadingNode[], depth: number) => {
      for (const n of nodes) {
        out.push({
          key: `${n.heading.book}-${n.heading.paragraph}`,
          node: n,
          depth,
        });
        if (n.children.length > 0 && expanded.has(n.heading.paragraph)) {
          walk(n.children, depth + 1);
        }
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, expanded]);

  const toggle = (paragraph: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(paragraph)) next.delete(paragraph);
      else next.add(paragraph);
      return next;
    });

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: c.backdrop }]}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelW,
              backgroundColor: c.paperRaised,
              borderLeftColor: c.border,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: c.hairline }]}>
            <Text style={[styles.headerTitle, { color: c.ink, fontFamily: serifFont }]}>
              目录
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={c.inkSoft} />
            </Pressable>
          </View>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <RowItem
                node={item.node}
                depth={item.depth}
                expanded={expanded.has(item.node.heading.paragraph)}
                current={item.node.heading.paragraph === currentParagraph}
                c={c}
                onToggle={toggle}
                onSelect={(n) => onSelect(n.heading.book, n.heading.paragraph)}
              />
            )}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

function RowItem({
  node,
  depth,
  expanded,
  current,
  c,
  onToggle,
  onSelect,
}: {
  node: HeadingNode;
  depth: number;
  expanded: boolean;
  current: boolean;
  c: ReaderChrome;
  onToggle: (paragraph: number) => void;
  onSelect: (node: HeadingNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  return (
    <View
      style={[
        styles.row,
        {
          paddingLeft: 12 + depth * 16,
          backgroundColor: current ? c.paperSunken : "transparent",
        },
      ]}
    >
      <Pressable
        style={styles.chevron}
        onPress={hasChildren ? () => onToggle(node.heading.paragraph) : undefined}
        hitSlop={6}
      >
        {hasChildren ? (
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={16}
            color={c.inkFaint}
          />
        ) : null}
      </Pressable>
      <Pressable style={styles.rowLabel} onPress={() => onSelect(node)}>
        <Text
          numberOfLines={1}
          style={[
            styles.rowText,
            {
              color: current ? c.vermilion : c.ink,
              fontWeight: current ? "700" : "400",
            },
          ]}
        >
          {node.heading.toc}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    height: "100%",
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
  },
  chevron: {
    width: 24,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    height: 40,
    justifyContent: "center",
    paddingRight: 12,
  },
  rowText: {
    fontSize: 15,
  },
});
