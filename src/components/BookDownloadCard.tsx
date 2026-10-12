/**
 * 频道详情里的一本书：两行卡片，底色当进度条。
 *
 *   第一行  作品名
 *   第二行  义注 · 已译 88% · 下载中 · 1.2 MB / ~3.4 MB · 180 KB/s
 *
 * 状态来自下载调度器的快照（`useDownloadRow`），不再自己轮询。
 * 已下载的整张卡点了就去读，右侧只留一个删除图标；没下完的右侧是
 * 下载 / 暂停 / 继续 / 重试。
 */
import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  clearDownloadData,
  pauseDownload,
  removeDownload,
  resumeDownload,
} from "../reading";
import { useDownloadRow } from "../hooks/useDownloads";
import { requestDownload } from "./downloadRequest";
import { statusLine } from "./downloadText";
import { colors, radius, spacing, type, serifFont } from "../theme";
import { useT } from "../i18n/I18nContext";

interface Props {
  book: number;
  /** 副标题左侧的固定信息（层次 · 已译 x%）。 */
  meta: string;
  title: string;
  channelId: string;
  /** 下载时所在段（用于同步时向上搜索到 level=1 锚定「书」）。 */
  paragraph?: number;
  /** 只读模式：不显示下载动作，仅书名 + 信息。 */
  readonly?: boolean;
  onPress: () => void;
}

export const BookDownloadCard = React.memo(BookDownloadCardImpl, (a, b) =>
  // onPress 每次都是新的箭头函数，比较时跳过；它依赖的书名变了 title 也会变。
  a.book === b.book &&
  a.title === b.title &&
  a.meta === b.meta &&
  a.channelId === b.channelId &&
  a.paragraph === b.paragraph &&
  a.readonly === b.readonly,
);

function BookDownloadCardImpl({
  book,
  title,
  meta,
  channelId,
  paragraph,
  readonly = false,
  onPress,
}: Props) {
  const t = useT();
  const { row: p, speed } = useDownloadRow(channelId, book);

  const status = p?.status ?? "pending";
  const ratio = p && p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  const line = statusLine(t, p, { speed });

  const start = () =>
    void requestDownload([{ channel: channelId, book, anchorPara: paragraph }], {
      title,
    });

  const remove = () => {
    Alert.alert(t("download.delete"), t("download.deleteChoose"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("download.deleteDataOnly"),
        onPress: () => void clearDownloadData(channelId, book),
      },
      {
        text: t("download.deleteDataAndRecord"),
        style: "destructive",
        onPress: () => void removeDownload(channelId, book),
      },
    ]);
  };

  const action = (() => {
    if (readonly) return null;
    if (status === "done") {
      return <IconAction icon="trash-outline" muted label={t("download.delete")} onPress={remove} />;
    }
    if (status === "downloading" || status === "queued") {
      return (
        <Action icon="pause" label={t("download.pause")} onPress={() => void pauseDownload(channelId, book)} />
      );
    }
    if (status === "waiting") {
      return p?.reason === "wifi_ready" ? (
        <Action icon="play" label={t("download.start")} onPress={() => void resumeDownload(channelId, book)} />
      ) : (
        <Action icon="pause" label={t("download.pause")} onPress={() => void pauseDownload(channelId, book)} />
      );
    }
    if (status === "paused") {
      return <Action icon="play" label={t("download.resume")} onPress={() => void resumeDownload(channelId, book)} />;
    }
    if (status === "error") {
      return <Action icon="refresh" label={t("download.retry")} onPress={() => void resumeDownload(channelId, book)} />;
    }
    return <Action icon="cloud-download-outline" label={t("download.start")} onPress={start} />;
  })();

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {/* 底色进度条：下到哪填到哪；下完就整块铺满。
          用 flex 分两段而不是给绝对定位的块写百分比宽 —— Yoga 把百分比算在
          父节点的**内容盒**上，100% 会短掉卡片左右各一份 padding，下完了
          右边仍留一条没填上的白边。 */}
      {ratio > 0 ? (
        <View style={styles.fillLayer} pointerEvents="none">
          <View style={[styles.fill, { flex: ratio }, status === "done" && styles.fillDone]} />
          <View style={{ flex: 1 - ratio }} />
        </View>
      ) : null}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {meta ? `${meta} · ` : ""}
          <Text
            style={
              line.tone === "warn"
                ? styles.warn
                : line.tone === "error"
                  ? styles.error
                  : undefined
            }
          >
            {line.text}
          </Text>
        </Text>
      </View>

      {readonly ? (
        <Ionicons name="chevron-forward" size={18} color={colors.vermilion} />
      ) : (
        <View style={styles.actions}>{action}</View>
      )}
    </Pressable>
  );
}

function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.action} onPress={onPress} hitSlop={8}>
      <Ionicons name={icon} size={16} color={colors.vermilion} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/** 只有图标的按钮（已下载的删除）；label 给读屏用。 */
function IconAction({
  icon,
  label,
  muted,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.iconAction}
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={19} color={muted ? colors.inkSoft : colors.vermilion} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  fillLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
  },
  fill: {
    backgroundColor: colors.paperSunken,
  },
  fillDone: {
    backgroundColor: "#eae4d2",
  },
  body: {
    flex: 1,
  },
  title: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  sub: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  warn: {
    color: colors.ochre,
  },
  error: {
    color: "#b0412e",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginLeft: spacing.sm,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  actionText: {
    ...type.small,
    color: colors.vermilion,
  },
  iconAction: {
    padding: 4,
  },
});
