/**
 * 紧凑的下载按钮：一个图标 +（下载中时）百分比。
 *
 * 用在空间紧张、又需要「一眼看见 + 一键触发」的地方：
 * 阅读器顶栏、版本列表的每一行。
 *
 * 只做「开始 / 暂停」。删除、错误详情等管理操作在 `DownloadControl`
 * （阅读器设置弹层、书架「已下载」）。
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  downloadBook,
  getDownloadProgress,
  isDownloading,
  pauseDownload,
  percent,
  type DownloadProgress,
} from "../reading";

interface Props {
  book: number;
  channelId: string;
  /** 图标颜色；已下载时用 doneColor。 */
  color: string;
  doneColor?: string;
  size?: number;
  /** 下载时所在段（用于同步时向上搜索到 level=1 锚定「书」）。 */
  paragraph?: number;
  /** 进度变化后的回调（列表据此刷新）。 */
  onChanged?: (p: DownloadProgress) => void;
}

export function DownloadIconButton({
  book,
  channelId,
  color,
  doneColor = "#52c41a",
  size = 20,
  paragraph,
  onChanged,
}: Props) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  const refresh = useCallback(async () => {
    setProgress(await getDownloadProgress(channelId, book));
  }, [book, channelId]);

  useEffect(() => {
    let alive = true;
    getDownloadProgress(channelId, book).then((p) => {
      if (alive) setProgress(p);
    });
    return () => {
      alive = false;
    };
  }, [book, channelId]);

  // 下载可能是在别处发起的（比如从版本列表点的，再进阅读器），轮询同步状态
  useEffect(() => {
    if (!isDownloading(channelId, book)) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [book, channelId, refresh, progress?.status]);

  const running = progress?.status === "downloading" && isDownloading(channelId, book);
  const done = progress?.status === "done";
  const pct = progress ? percent(progress) : 0;

  const onPress = () => {
    if (done) return;
    if (running) {
      pauseDownload(channelId, book);
      refresh();
      return;
    }
    downloadBook(channelId, book, (p) => {
      setProgress(p);
      onChanged?.(p);
    }, paragraph).finally(refresh);
  };

  const icon: keyof typeof Ionicons.glyphMap = done
    ? "cloud-done"
    : progress?.status === "error"
      ? "alert-circle-outline"
      : running
        ? "pause-circle-outline"
        : "cloud-download-outline";

  return (
    <Pressable style={styles.wrap} onPress={onPress} hitSlop={8}>
      <Ionicons name={icon} size={size} color={done ? doneColor : color} />
      {/* 未开始不显示数字；下载中/暂停显示百分比，便于一眼看进度 */}
      {!done && progress && progress.done > 0 ? (
        <Text style={[styles.pct, { color }]}>{pct}%</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minWidth: 34,
  },
  pct: {
    fontSize: 10,
  },
});
