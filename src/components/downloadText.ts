/**
 * 下载状态的展示文案：数据量、速度、剩余时间、状态行（`docs/download-manager.md` §7）。
 */
import { estimateTotalBytes, type DownloadProgress } from "../reading";
import type { MessageKey } from "../i18n";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const MB = 1024 * 1024;

/** 字节 → 「812 KB」/「3.4 MB」。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 0.995 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  // 不足 1 KB 也记 1 KB：显示「0 KB」像是没下到东西。
  return bytes > 0 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : "0 KB";
}

/** 字节 / 秒 → 「180 KB/s」；太慢显示「—」。 */
export function formatSpeed(bps: number): string {
  return bps < 1024 ? "—" : `${formatBytes(bps)}/s`;
}

/** 剩余时间；算不出来返回空串。 */
export function formatRemaining(t: T, seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds >= 3600) return t("download.remainLong");
  if (seconds >= 60) return t("download.remainMin", { n: Math.ceil(seconds / 60) });
  return t("download.remainSec", { n: Math.ceil(seconds) });
}

/** 已下 / 约总量（总量按已下字节与段数估算）。 */
export function bytesLine(p: DownloadProgress): string {
  if (p.bytes <= 0) return "";
  const total = estimateTotalBytes(p.bytes, p.done, p.total);
  return total ? `${formatBytes(p.bytes)} / ~${formatBytes(total)}` : formatBytes(p.bytes);
}

export type Tone = "normal" | "warn" | "error" | "ok";

/**
 * 一本书的状态行：
 *   下载中 · 1.2 MB / ~3.4 MB · 180 KB/s · 剩 12 秒
 *   排队中 · 第 3 位
 *   等待中 · 等待 Wi‑Fi
 */
export function statusLine(
  t: T,
  p: DownloadProgress | undefined,
  opts: { speed?: number; queueIndex?: number; now?: number } = {},
): { text: string; tone: Tone } {
  if (!p || p.status === "pending") {
    return { text: t("download.notDownloaded"), tone: "normal" };
  }
  const join = (...parts: (string | false | undefined)[]) =>
    parts.filter(Boolean).join(" · ");
  switch (p.status) {
    case "done":
      return { text: join(t("download.done"), p.bytes > 0 && formatBytes(p.bytes)), tone: "ok" };
    case "downloading": {
      const speed = opts.speed ?? 0;
      const total = estimateTotalBytes(p.bytes, p.done, p.total);
      const remain = total && speed > 0 ? formatRemaining(t, (total - p.bytes) / speed) : "";
      return {
        text: join(t("download.downloading"), bytesLine(p), speed > 0 && formatSpeed(speed), remain),
        tone: "normal",
      };
    }
    case "queued":
      return {
        text:
          opts.queueIndex != null
            ? t("download.queuePos", { n: opts.queueIndex + 1 })
            : t("download.queued"),
        tone: "normal",
      };
    case "waiting": {
      if (p.reason === "retry") {
        const s = Math.max(0, Math.ceil(((p.nextRetryAt ?? 0) - (opts.now ?? Date.now())) / 1000));
        return { text: join(t("download.waiting"), t("download.retryIn", { s, n: p.attempts })), tone: "warn" };
      }
      const reason: MessageKey =
        p.reason === "background"
          ? "download.reason.background"
          : p.reason === "network"
            ? "download.reason.network"
            : p.reason === "wifi_ready"
              ? "download.reason.wifiReady"
              : "download.reason.wifi";
      return { text: join(t("download.waiting"), t(reason), bytesLine(p)), tone: "warn" };
    }
    case "paused":
      return { text: join(t("download.paused"), bytesLine(p)), tone: "normal" };
    case "error":
      return { text: join(t("download.failed"), p.error ?? undefined), tone: "error" };
  }
}
