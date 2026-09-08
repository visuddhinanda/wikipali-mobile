/**
 * 整本书离线下载的控件（进度环 + 状态 + 操作按钮）。
 *
 * 服务层在 `src/reading/download.ts`（`docs/reading-content.md` §4.4）：
 * 进度由数据本身推出，断点续传不需要状态机 —— 所以这里也不用自己维护
 * 「下到第几段」，只按回调刷新百分比即可。
 *
 * 阅读器（设置弹层）与书架（已下载列表）共用。
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProgressRing } from "./ProgressRing";
import {
  clearBookCache,
  downloadBook,
  getDownloadProgress,
  isDownloading,
  pauseDownload,
  percent,
  type DownloadProgress,
} from "../reading";
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
  /** 版本/频道；未选定版本时下载无从谈起，传 undefined 会禁用控件。 */
  channelId?: string;
  /** 配色，让阅读器（纸色/夜间）与书架（应用主题）都能用。 */
  colors: {
    ink: string;
    inkSoft: string;
    inkFaint: string;
    accent: string;
    track: string;
  };
  /** 删除下载后的回调（书架列表据此刷新）。 */
  onDeleted?: () => void;
  /**
   * 强制轮询进度。下载由外部发起时（频道页的「全部下载」串行跑到这一本）
   * 本组件的 `progress` 一直是挂载时的快照，`isDownloading` 也是挂载那刻的
   * 假值，自身的轮询条件永远不成立 —— 这行会一直显示「未下载」。
   */
  watch?: boolean;
}

export function DownloadControl({
  book,
  channelId,
  colors,
  onDeleted,
  watch = false,
}: Props) {
  const t = useT();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!channelId) return;
    setProgress(await getDownloadProgress(channelId, book));
  }, [book, channelId]);

  useEffect(() => {
    let alive = true;
    if (!channelId) {
      setProgress(null);
      return;
    }
    getDownloadProgress(channelId, book).then((p) => {
      if (alive) setProgress(p);
    });
    return () => {
      alive = false;
    };
  }, [book, channelId]);

  // 下载在别处发起时（例如从阅读器点的、返回书架后仍在跑），轮询刷新进度。
  useEffect(() => {
    if (!channelId || (!watch && !isDownloading(channelId, book))) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [book, channelId, refresh, watch, progress?.status]);

  if (!channelId) {
    return (
      <Text style={[styles.hint, { color: colors.inkFaint }]}>
        {t("download.pickVersionFirst")}
      </Text>
    );
  }

  const p = progress;
  const running = p?.status === "downloading" && isDownloading(channelId, book);
  const ratio = p && p.total > 0 ? p.done / p.total : 0;

  const start = async () => {
    setBusy(true);
    try {
      // downloadBook 会一直跑到结束，中途通过 onProgress 刷新 UI
      await downloadBook(channelId, book, setProgress);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const pause = () => {
    pauseDownload(channelId, book);
    refresh();
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
          onDeleted?.();
        },
      },
    ]);
  };

  return (
    <View style={styles.row}>
      <ProgressRing
        progress={ratio}
        size={34}
        color={p?.status === "done" ? undefined : colors.accent}
        trackColor={colors.track}
      />
      <View style={styles.body}>
        <Text style={[styles.status, { color: colors.ink }]}>
          {t(STATUS_LABEL[p?.status ?? "pending"])}
        </Text>
        <Text
          style={[styles.detail, { color: colors.inkSoft }]}
          numberOfLines={1}
        >
          {p?.status === "error" && p.error
            ? p.error
            : t("download.paraCount", {
                done: p?.done ?? 0,
                total: p?.total ?? 0,
              })}
        </Text>
      </View>

      {running ? (
        <ActionBtn
          icon="pause"
          label={t("download.pause")}
          color={colors.accent}
          onPress={pause}
        />
      ) : (
        <View style={styles.actions}>
          {/* 已下完就没有「继续」可言 */}
          {p?.status !== "done" ? (
            <ActionBtn
              icon="cloud-download-outline"
              label={
                p && p.done > 0 ? t("download.resume") : t("download.start")
              }
              color={colors.accent}
              disabled={busy}
              onPress={start}
            />
          ) : null}
          {/* 只要有已缓存的段就能删 —— 暂停/失败的半截下载同样占空间 */}
          {p && p.done > 0 ? (
            <ActionBtn
              icon="trash-outline"
              label={t("download.delete")}
              color={colors.inkSoft}
              onPress={remove}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function ActionBtn({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.btnLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  body: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  status: {
    fontSize: 14,
    fontWeight: "600",
  },
  detail: {
    fontSize: 12,
    marginTop: 2,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnLabel: {
    fontSize: 13,
  },
  hint: {
    fontSize: 13,
  },
});
