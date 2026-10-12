/**
 * 紧凑的下载按钮：一个图标 +（下载中时）百分比。
 *
 * 用在空间紧张、又需要「一眼看见 + 一键触发」的地方：
 * 阅读器顶栏、版本列表的每一行。状态来自下载调度器快照。
 *
 * 只做「开始 / 暂停 / 继续」。删除、错误详情等管理操作在频道页与下载管理页。
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { pauseDownload, percent, resumeDownload } from "../reading";
import { useDownloadRow } from "../hooks/useDownloads";
import { requestDownload } from "./downloadRequest";

interface Props {
  book: number;
  channelId: string;
  /** 图标颜色；已下载时用 doneColor。 */
  color: string;
  doneColor?: string;
  size?: number;
  /** 下载时所在段（用于同步时向上搜索到 level=1 锚定「书」）。 */
  paragraph?: number;
  /** 移动网络询问面板里显示的书名。 */
  title?: string;
}

export function DownloadIconButton({
  book,
  channelId,
  color,
  doneColor = "#52c41a",
  size = 20,
  paragraph,
  title,
}: Props) {
  const { row: p } = useDownloadRow(channelId, book);
  const status = p?.status ?? "pending";
  const done = status === "done";
  const active =
    status === "downloading" ||
    status === "queued" ||
    (status === "waiting" && p?.reason !== "wifi_ready");

  const onPress = () => {
    if (done) return;
    if (active) return void pauseDownload(channelId, book);
    if (p && status !== "pending") return void resumeDownload(channelId, book);
    void requestDownload([{ channel: channelId, book, anchorPara: paragraph }], { title });
  };

  const icon: keyof typeof Ionicons.glyphMap = done
    ? "cloud-done"
    : status === "error"
      ? "alert-circle-outline"
      : status === "downloading"
        ? "pause-circle-outline"
        : status === "queued" || status === "waiting"
          ? "time-outline"
          : "cloud-download-outline";

  return (
    <Pressable style={styles.wrap} onPress={onPress} hitSlop={8}>
      <Ionicons name={icon} size={size} color={done ? doneColor : color} />
      {/* 未开始不显示数字；下载中/暂停显示百分比，便于一眼看进度 */}
      {!done && p && p.done > 0 ? (
        <Text style={[styles.pct, { color }]}>{percent(p)}%</Text>
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
