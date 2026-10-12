/**
 * 订阅下载调度器的快照（`src/reading/downloadManager.ts`）。
 *
 * 全 App 一个数据源：频道页、书架、下载管理、阅读页的下载按钮看到的是同一份状态，
 * 不再各自轮询数据库。快照里没变的行沿用旧对象，所以按「行 / 行列表 / 速度」分开订阅：
 * 一本书的卡片只在这本书变了才重渲染，每秒的测速只牵动显示速度的那几处。
 */
import { useMemo, useSyncExternalStore } from "react";
import {
  downloadKey,
  getDownloadSnapshot,
  subscribeDownloads,
  type DownloadEnv,
  type DownloadProgress,
  type DownloadSnapshot,
} from "../reading";

/** 整份快照（含速度，每秒可能变一次）。只给真要全部信息的页面用。 */
export function useDownloads(): DownloadSnapshot {
  return useSyncExternalStore(subscribeDownloads, getDownloadSnapshot);
}

/** 全部下载记录（行没变时引用不变）。 */
export function useDownloadRows(): DownloadProgress[] {
  return useSyncExternalStore(subscribeDownloads, () => getDownloadSnapshot().rows);
}

/** 正在下载那本的 key 与速度（字节 / 秒）。 */
export function useRunningDownload(): { key: string | null; speed: number } {
  const key = useSyncExternalStore(subscribeDownloads, () => getDownloadSnapshot().runningKey);
  const speed = useSyncExternalStore(subscribeDownloads, () => getDownloadSnapshot().speed);
  return { key, speed };
}

export function useDownloadEnv(): DownloadEnv {
  return useSyncExternalStore(subscribeDownloads, () => getDownloadSnapshot().env);
}

/** 一本书的下载记录（没有记录返回 undefined = 未下载）+ 是否正在跑、速度。 */
export function useDownloadRow(
  channelId: string | undefined,
  book: number,
): { row?: DownloadProgress; running: boolean; speed: number } {
  const key = channelId ? downloadKey(channelId, book) : null;
  const row = useSyncExternalStore(subscribeDownloads, () =>
    key ? getDownloadSnapshot().byKey.get(key) : undefined,
  );
  const running = useSyncExternalStore(
    subscribeDownloads,
    () => key != null && getDownloadSnapshot().runningKey === key,
  );
  const speed = useSyncExternalStore(subscribeDownloads, () =>
    running ? getDownloadSnapshot().speed : 0,
  );
  return { row, running, speed };
}

export interface DownloadSummary {
  /** 下载中 + 排队 + 等待。 */
  active: number;
  downloading: number;
  queued: number;
  waiting: number;
  /** 其中等 Wi‑Fi 的。 */
  waitingWifi: number;
  paused: number;
  failed: number;
  done: number;
  speed: number;
}

export function summarize(
  rows: DownloadProgress[],
  speed: number,
): DownloadSummary {
  const s: DownloadSummary = {
    active: 0,
    downloading: 0,
    queued: 0,
    waiting: 0,
    waitingWifi: 0,
    paused: 0,
    failed: 0,
    done: 0,
    speed,
  };
  for (const r of rows) {
    if (r.status === "downloading") s.downloading++;
    else if (r.status === "queued") s.queued++;
    else if (r.status === "waiting") {
      s.waiting++;
      if (r.reason === "wifi") s.waitingWifi++;
    } else if (r.status === "paused") s.paused++;
    else if (r.status === "error") s.failed++;
    else if (r.status === "done") s.done++;
  }
  s.active = s.downloading + s.queued + s.waiting;
  return s;
}

/** 全部记录的汇总（行变了才重算）。 */
export function useDownloadSummary(): DownloadSummary {
  const rows = useDownloadRows();
  const { speed } = useRunningDownload();
  return useMemo(() => summarize(rows, speed), [rows, speed]);
}
