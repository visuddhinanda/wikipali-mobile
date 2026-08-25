import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 问答广场的占位信息流（P2 接入公开问题列表 + citations）。 */
const FEED = [
  { q: "什么是四圣谛？", lang: "中文", cited: true },
  { q: "缘起与十二因缘的关系？", lang: "中文", cited: true },
  { q: "What is anatta?", lang: "English", cited: false },
];

export function AiChatScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen contentStyle={styles.content}>
      {/* 顶部标语 + 输入框 → 新对话页 */}
      <Text style={styles.tagline}>与ai助手一起探索三藏奥义</Text>
      <Pressable
        style={styles.inputBar}
        onPress={() => navigation.navigate("NewChat")}
      >
        <Text style={styles.inputPlaceholder}>提出一个新问题…</Text>
        <View style={styles.sendBtn}>
          <Ionicons name="arrow-up" size={18} color={colors.paperRaised} />
        </View>
      </Pressable>

      {/* 信息流卡片 */}
      {FEED.map((item, i) => (
        <Pressable
          key={i}
          style={styles.card}
          onPress={() => navigation.navigate("NewChat", { seedText: item.q })}
        >
          <Text style={styles.cardQuestion}>{item.q}</Text>
          <View style={styles.cardMeta}>
            <View style={styles.langTag}>
              <Text style={styles.langTagText}>{item.lang}</Text>
            </View>
            {item.cited ? (
              <View style={styles.citeTag}>
                <Ionicons name="book" size={12} color={colors.ochre} />
                <Text style={styles.citeTagText}>引用经文</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  tagline: {
    ...type.heading,
    fontFamily: serifFont,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  inputPlaceholder: {
    flex: 1,
    ...type.caption,
    color: colors.inkFaint,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.vermilion,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardQuestion: {
    ...type.body,
    fontWeight: "600",
  },
  cardMeta: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  langTag: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  langTagText: {
    ...type.small,
  },
  citeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  citeTagText: {
    ...type.small,
    color: colors.ochre,
  },
});
