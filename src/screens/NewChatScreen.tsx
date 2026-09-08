import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import {
  CopilotChat,
  useCopilotChatContext,
  useRenderTool,
  useRenderToolCall,
} from "@copilotkit/react-native";
import { StreamdownText } from "react-native-streamdown";
import { z } from "zod";
import { colors, radius, spacing, type } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * 从 wikipali 阅读器链接解析 book/paragraph/channel。
 * 例：`…/library/tipitaka/188-459/read?channel=translation`
 *   - `channel=translation`：特殊标记，表示「列出该章节全部版本」
 *   - `channel=<uuid>`：具体频道 id，直接按该版本请求经文
 */
function parsePassage(url: string): {
  book: number;
  paragraph: number;
  channel?: string;
} | null {
  const m = url.match(/\/library\/tipitaka\/(\d+)-(\d+)(?:\/|$)/);
  if (!m) return null;

  const raw = /[?&]channel=([^&#]+)/.exec(url)?.[1];
  let channel: string | undefined;
  if (raw) {
    try {
      channel = decodeURIComponent(raw);
    } catch {
      channel = raw;
    }
  }

  return { book: Number(m[1]), paragraph: Number(m[2]), channel };
}

/** 工具名 → 文案 key。 */
const TOOL_LABELS: Record<string, MessageKey> = {
  wikipali_forms: "tool.wikipali_forms",
  wikipali_search: "tool.wikipali_search",
  wikipali_get: "tool.wikipali_get",
  wikipali_dist: "tool.wikipali_dist",
  wikipali_word: "tool.wikipali_word",
  wikipali_count: "tool.wikipali_count",
  wikipali_terms: "tool.wikipali_terms",
  wikipali_books: "tool.wikipali_books",
  wikipali_toc: "tool.wikipali_toc",
  wikipali_paras: "tool.wikipali_paras",
  wikipali_chapter: "tool.wikipali_chapter",
  wikipali_chapter_fetch: "tool.wikipali_chapter_fetch",
  wikipali_versions: "tool.wikipali_versions",
  wikipali_related: "tool.wikipali_related",
  wikipali_articles: "tool.wikipali_articles",
  wikipali_article: "tool.wikipali_article",
  wikipali_anthology: "tool.wikipali_anthology",
};

/** 引用链接的 tag 样式（按 URL 模式匹配 wikipali 阅读器链接）。 */
const markdownStyle = {
  link: {
    color: colors.vermilion,
    underline: false as const,
  },
  linkVariants: {
    "\\/library\\/tipitaka\\/": {
      color: "#6b7280", // 灰色字
      underline: false as const,
      backgroundColor: "#e5e7eb", // 淡灰底色（胶囊 tag）
    },
  },
};

function ToolCallBubble(props: any) {
  const { name, status } = props;
  const t = useT();
  const running = String(status) !== "complete";
  const key = TOOL_LABELS[name];
  // 后端可能加了新工具，没有对应文案时直接显示工具名。
  const label = key ? t(key) : name;
  return (
    <View style={styles.toolBubble}>
      {running ? (
        <ActivityIndicator size="small" color={colors.ochre} />
      ) : (
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
      )}
      <Text style={styles.toolBubbleText}>
        {label} {running ? t("chat.toolRunning") : t("chat.toolDone")}
      </Text>
    </View>
  );
}

function ChatUI({
  seedText,
  draftText,
  systemPrompt,
}: {
  seedText?: string;
  draftText?: string;
  systemPrompt?: string;
}) {
  const navigation = useNavigation<Nav>();
  const t = useT();
  const { agent, messages, isRunning, submitMessage } = useCopilotChatContext();
  const renderToolCall = useRenderToolCall();
  const [input, setInput] = React.useState(draftText ?? "");
  const listRef = useRef<FlatList>(null);
  const headerHeight = useHeaderHeight();

  // 「就此段落提问」带来的预置追问：进入对话后自动提交一次。
  // 用 ref 取最新 submitMessage，依赖只放 seedText，避免 submitMessage 引用
  // 每帧变化导致 effect 反复触发（"Maximum update depth exceeded"）。
  const submitMessageRef = useRef(submitMessage);
  submitMessageRef.current = submitMessage;
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    // 系统提示词要排在第一条用户消息**之前**，不然模型是在没有上下文的
    // 情况下先读到问题的（阅读器过来的「查词/提问」全靠它交代章节坐标）。
    if (systemPrompt) {
      agent?.addMessage?.({
        id: `sys-${Date.now()}`,
        role: "system",
        content: systemPrompt,
      });
    }
    if (seedText) submitMessageRef.current(seedText);
  }, [seedText, systemPrompt, agent]);

  // 「思考中」指示：AI 在跑、但当前既没在流式输出正文、也没在跑工具（查资料）时显示。
  const lastMsg: any =
    messages && messages.length > 0 ? messages[messages.length - 1] : null;
  const assistantStreaming = lastMsg?.role === "assistant" && !!lastMsg.content;
  const runningTool =
    lastMsg?.role === "assistant"
      ? (lastMsg.toolCalls ?? []).find(
          (tc: any) => String(tc.status) !== "complete",
        )
      : null;
  const showThinking = isRunning && !assistantStreaming && !runningTool;

  useRenderTool(
    {
      name: "*",
      description: t("chat.toolStatusDesc"),
      parameters: z.object({}),
      render: ToolCallBubble,
    },
    [],
  );

  const handleLinkPress = (event: { url: string }) => {
    const parsed = parsePassage(event.url);
    if (!parsed) return;
    const title = `${parsed.book}-${parsed.paragraph}`;

    // channel=translation：先查询该章节全部版本，列出让用户选择后再读经文；
    // channel=<uuid>：直接按该版本请求经文；无 channel：走旧 chapter-content 接口。
    if (parsed.channel === "translation") {
      navigation.navigate("BookChannels", {
        book: parsed.book,
        paragraph: parsed.paragraph,
        title,
      });
      return;
    }

    navigation.navigate("Reader", {
      book: parsed.book,
      paragraph: parsed.paragraph,
      title,
      channelId: parsed.channel,
    });
  };

  const send = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    submitMessage(text);
  };

  const renderItem = ({ item }: { item: any }) => {
    if (item.role === "user") {
      return (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{item.content}</Text>
          </View>
        </View>
      );
    }
    if (item.role === "assistant") {
      return (
        <View style={styles.assistantRow}>
          {(item.toolCalls ?? []).map((tc: any) => {
            const toolMessage = (messages ?? []).find(
              (m: any) => m.role === "tool" && m.toolCallId === tc.id,
            );
            return renderToolCall({ toolCall: tc, toolMessage });
          })}
          {item.content ? (
            <View style={styles.assistantBubble}>
              <StreamdownText
                markdown={item.content}
                flavor="github"
                streamingAnimation
                onLinkPress={handleLinkPress}
                markdownStyle={markdownStyle}
              />
            </View>
          ) : null}
        </View>
      );
    }
    // tool 结果消息不单独渲染（已并入 tool call 气泡）
    return null;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        ref={listRef}
        data={messages ?? []}
        keyExtractor={(m: any) => m.id}
        renderItem={renderItem}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: true })
        }
        contentContainerStyle={styles.listContent}
        style={styles.list}
        ListFooterComponent={
          showThinking ? (
            <View style={styles.thinkingBubble}>
              <ActivityIndicator size="small" color={colors.vermilion} />
              <Text style={styles.thinkingText}>{t("chat.thinking")}</Text>
            </View>
          ) : null
        }
      />
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t("chat.followUp")}
          placeholderTextColor={colors.inkFaint}
          multiline
          onSubmitEditing={send}
        />
        {isRunning ? (
          <Pressable style={styles.stopBtn} onPress={() => agent?.stop?.()}>
            <View style={styles.stopSquare} />
          </Pressable>
        ) : (
          <Pressable style={styles.sendBtn} onPress={send}>
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export function NewChatScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, "NewChat">) {
  const { seedText, draftText, systemPrompt } = route.params ?? {};
  return (
    <CopilotChat agentId="pali_agent">
      <ChatUI
        seedText={seedText}
        draftText={draftText}
        systemPrompt={systemPrompt}
      />
    </CopilotChat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  userBubble: {
    maxWidth: "80%",
    backgroundColor: colors.vermilion,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  userText: {
    ...type.body,
    color: colors.paperRaised,
  },
  assistantRow: {
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  assistantBubble: {
    maxWidth: "100%",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toolBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.paperSunken,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  toolBubbleText: {
    ...type.small,
    color: colors.inkSoft,
  },
  thinkingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.paperSunken,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  thinkingText: {
    ...type.small,
    color: colors.inkSoft,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.paperRaised,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.paperSunken,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...type.body,
    color: colors.ink,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.vermilion,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIcon: {
    color: colors.paperRaised,
    fontSize: 18,
    fontWeight: "700",
  },
  stopBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.inkSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: {
    width: 12,
    height: 12,
    backgroundColor: colors.paperRaised,
    borderRadius: 2,
  },
});
