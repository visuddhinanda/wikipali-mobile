/**
 * 频道详情里的一本书：两行卡片，底色当进度条。
 *
 *   第一行  作品名
 *   第二行  义注 · 已译 88% · 已下载 · 删除
 *
 * 进度不再单列一行环形控件 —— 卡片自己被填满多少就是下到哪了，
 * 一屏能多放几本书，扫一眼也知道整批下到什么程度。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  clearBookCache,
  downloadBook,
  getDownloadProgress,
  isDownloading,
  pauseDownload,
  type DownloadProgress,
} from "../reading";
import { colors, radius, spacing, type, serifFont } from "../theme";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

const STATUS_LABEL: Record<DownloadProgress["status"], MessageKey> = {
  pending: "download.notDownloaded",
  downloading: "download.downloading",
  paused: "download.paused",
  done: "download.done",
  error: "download.failed",
};

interface Props {
  book: number;
  /** 副标题左侧的固定信息（层次 · 已译 x%）。 */
  meta: string;
  title: string;
  channelId: string;
  /** 外部（「全部下载」）正在跑时强制轮询，见 DownloadControl 同名参数。 */
  watch?: boolean;
  /** 只读模式：不显示下载动作，仅书名 + 信息。 */
  readonly?: boolean;
  onPress: () => void;
  /** 进度变化（用于父级筛选与排序）。 */
  onProgress?: (p: DownloadProgress) => void;
}

export function BookDownloadCard({
  book,
  title,
  meta,
  channelId,
  watch = false,
  readonly = false,
  onPress,
  onProgress,
}: Props) {
  const t = useT();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);

  // 回调放 ref 里：父级通常传的是行内箭头函数，直接进依赖会让下面的
  // 「取一次进度」effect 每次渲染都重跑，setState 再触发渲染，转成死循环。
  const report = useRef(onProgress);
  report.current = onProgress;

  const apply = useCallback((p: DownloadProgress) => {
    setProgress(p);
    report.current?.(p);
  }, []);

  const refresh = useCallback(async () => {
    apply(await getDownloadProgress(channelId, book));
  }, [apply, book, channelId]);

  useEffect(() => {
    let alive = true;
    getDownloadProgress(channelId, book).then((p) => {
      if (alive) apply(p);
    });
    return () => {
      alive = false;
    };
  }, [apply, book, channelId]);

  useEffect(() => {
    if (!watch && !isDownloading(channelId, book)) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [book, channelId, refresh, watch, progress?.status]);

  const p = progress;
  const running = p?.status === "downloading" && isDownloading(channelId, book);
  const ratio = p && p.total > 0 ? Math.min(1, p.done / p.total) : 0;

  const start = async () => {
    setBusy(true);
    try {
      await downloadBook(channelId, book, apply);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const remove = () => {
    Alert.alert(t("download.delete"), t("download.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("download.delete"),
        style: "destructive",
        onPress: async () => {
          if (isDownloading(channelId, book)) pauseDownload(channelId, book);
          await clearBookCache(channelId, book);
          await refresh();
        },
      },
    ]);
  };

  const status = p ? t(STATUS_LABEL[p.status]) : "";
  const sub = [meta, status].filter(Boolean).join(" · ");

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {/* 底色进度条：下到哪填到哪；下完就整块铺满。 */}
      {ratio > 0 ? (
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%` },
            p?.status === "done" && styles.fillDone,
          ]}
        />
      ) : null}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
          {running && p ? ` · ${Math.round(ratio * 100)}%` : ""}
        </Text>
      </View>

      {readonly ? (
        <Ionicons name="chevron-forward" size={18} color={colors.vermilion} />
      ) : (
        <View style={styles.actions}>
          {running ? (
            <Action
              icon="pause"
              label={t("download.pause")}
              onPress={() => {
                pauseDownload(channelId, book);
                void refresh();
              }}
            />
          ) : p?.status !== "done" ? (
            <Action
              icon="cloud-download-outline"
              label={
                p && p.done > 0 ? t("download.resume") : t("download.start")
              }
              disabled={busy}
              onPress={start}
            />
          ) : null}
          {p && p.done > 0 ? (
            <Action
              icon="trash-outline"
              label={t("download.delete")}
              muted
              onPress={remove}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function Action({
  icon,
  label,
  muted,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  muted?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = muted ? colors.inkSoft : colors.vermilion;
  return (
    <Pressable
      style={[styles.action, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
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
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    ...type.small,
  },
});
