/**
 * 下载调度器（单例，见 `docs/download-manager.md` §5）。
 *
 * - **队列在库里**：`download_state` 是唯一真源，这里只记「正在跑哪一本」。
 * - **单写者**：同一时刻只跑一本（游标通道每块写 SQLite；expo-sqlite 并发原生调用会
 *   NPE，见 `docs/download-manager.md` §5.2 与 `src/reading/db.ts` 文件头）。
 * - **系统等待自动恢复**：后台 / 断网 / 等 Wi‑Fi / 失败退避都记成 `waiting(<原因>)`，
 *   条件满足后回 `queued`；只有用户暂停的 `paused` 不自动恢复。
 * - **快照订阅**：UI 通过 `subscribeDownloads` / `getDownloadSnapshot`
 *   （`useDownloads` hook）拿到同一份状态，不再各组件轮询。
 */
import { AppState, type AppStateStatus } from "react-native";
import * as Network from "expo-network";
import {
  allowCellularRows,
  cancelDownloadRows,
  clearDownloadRows,
  enqueueRows,
  listDownloads,
  moveRowToTop,
  reconcileRows,
  removeDownloadRows,
  runBook,
  setRowState,
  setStatesWhere,
  type DownloadProgress,
  type EnqueueItem,
  type RunOutcome,
} from "./download";
import {
  blocker,
  pickNext,
  retryAt,
  settle,
  SpeedMeter,
  type DownloadEnv,
  type QueueRow,
  type WaitReason,
} from "./downloadPolicy";
import {
  getDownloadSettings,
  loadDownloadSettings,
  onDownloadSettingsChange,
} from "../settings/download";
import { onScopeChange } from "../user/userScope";

export const downloadKey = (channel: string, book: number) => `${channel}/${book}`;

export interface DownloadSnapshot {
  /** 每次变化递增（useSyncExternalStore 靠引用变化，这里另给一个可读的计数）。 */
  version: number;
  /** 当前用户全部下载记录（按 updated_at 倒序）。 */
  rows: DownloadProgress[];
  byKey: Map<string, DownloadProgress>;
  /** 正在下载的那本（单写者，最多一本）。 */
  runningKey: string | null;
  /** 正在下载那本的速度（字节 / 秒）。 */
  speed: number;
  env: DownloadEnv;
}

type StopMode =
  | { kind: "pause" }
  | { kind: "requeue" }
  | { kind: "wait"; reason: WaitReason }
  | { kind: "discard" };

interface Running {
  key: string;
  channel: string;
  book: number;
  stop: StopMode | null;
  finished: Promise<void>;
  meter: SpeedMeter;
}

let env: DownloadEnv = {
  active: AppState.currentState !== "background",
  connected: true,
  cellular: false,
  cellularAllowed: false,
  autoOnWifi: true,
};
let running: Running | null = null;
/** 切用户期间：不开新的。 */
let suspended = false;
let started = false;
/** 本模块实例已被 Fast Refresh 替换（开发时）：不再调度。 */
let disposed = false;
/** 环境监听的退订函数（Fast Refresh 时清掉）。 */
const unsubs: (() => void)[] = [];

let snapshot: DownloadSnapshot = {
  version: 0,
  rows: [],
  byKey: new Map(),
  runningKey: null,
  speed: 0,
  env,
};
const listeners = new Set<() => void>();

// ── 快照 ──

export function getDownloadSnapshot(): DownloadSnapshot {
  return snapshot;
}

export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function sameRow(a: DownloadProgress, b: DownloadProgress): boolean {
  for (const k of Object.keys(b) as (keyof DownloadProgress)[]) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * 发布新快照。没变的行沿用旧对象、整张表没变就沿用旧数组 —— 订阅单行 / 行列表的
 * 组件只在自己那行变了才重渲染（几百本排队时，每秒的测速刷新不能带着整页重画）。
 */
function emit(next?: DownloadProgress[]): void {
  const at = Date.now();
  const key = running?.key;
  let rows = snapshot.rows;
  let byKey = snapshot.byKey;
  if (next) {
    let changed = next.length !== snapshot.rows.length;
    const merged = next.map((r, i) => {
      const k = downloadKey(r.channel, r.book);
      // 刚开跑的那本，库里第一次落「downloading」之前还是 queued：快照里先按下载中显示。
      const row = r.status === "queued" && k === key ? { ...r, status: "downloading" as const } : r;
      const old = snapshot.byKey.get(k);
      const kept = old && sameRow(old, row) ? old : row;
      if (kept !== snapshot.rows[i]) changed = true;
      return kept;
    });
    if (changed) {
      rows = merged;
      byKey = new Map(rows.map((r) => [downloadKey(r.channel, r.book), r]));
    }
  }
  // 速度取整到 1 KB/s，免得每秒的小抖动也算一次变化。
  const speed = running ? Math.round(running.meter.speed(at) / 1024) * 1024 : 0;
  const runningKey = key ?? null;
  if (
    rows === snapshot.rows &&
    speed === snapshot.speed &&
    runningKey === snapshot.runningKey &&
    env === snapshot.env
  ) {
    return;
  }
  snapshot = { version: snapshot.version + 1, rows, byKey, runningKey, speed, env };
  for (const fn of listeners) fn();
}

let refreshing: Promise<void> | null = null;
let refreshAgain = false;

/** 重读库里的下载记录并通知订阅者（并发调用合并成一次）。 */
export async function refreshDownloads(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      do {
        refreshAgain = false;
        emit(await listDownloads());
      } while (refreshAgain);
    } catch {
      // 库暂不可用（切用户中）：保留旧快照，下次再刷。
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// 下载中每秒刷一次速度（没有新块时速度要能降下来）。
let speedTimer: ReturnType<typeof setInterval> | null = null;
function syncSpeedTimer(): void {
  if (running && !speedTimer) speedTimer = setInterval(() => emit(), 1_000);
  if (!running && speedTimer) {
    clearInterval(speedTimer);
    speedTimer = null;
  }
}

// ── 调度 ──

const queueRow = (r: DownloadProgress): QueueRow => ({
  status: r.status,
  reason: r.reason,
  queuePos: r.queuePos,
  allowCellular: r.allowCellular,
  nextRetryAt: r.nextRetryAt,
});

let ticking = false;
let tickAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** 按当前环境整理队列并补上下一本（重入时合并成一次重跑）。 */
export function kickDownloads(): void {
  void tick();
}

async function tick(): Promise<void> {
  if (disposed) return;
  if (ticking) {
    tickAgain = true;
    return;
  }
  ticking = true;
  try {
    do {
      tickAgain = false;
      await tickOnce();
    } while (tickAgain);
  } catch {
    // 库暂不可用：下一次环境变化 / 操作会再触发。
  } finally {
    ticking = false;
  }
}

async function tickOnce(): Promise<void> {
  let rows = await listDownloads();
  const now = Date.now();

  // 在跑的那本：环境不允许了就叫停（跑完当前块再停）。
  if (running && !running.stop) {
    const cur = rows.find((r) => downloadKey(r.channel, r.book) === running!.key);
    const b = cur ? blocker(queueRow(cur), env) : null;
    if (b) running.stop = { kind: "wait", reason: b };
  }

  // 排队中 / 等待中的按环境归位。
  let changed = false;
  for (const r of rows) {
    if (running && downloadKey(r.channel, r.book) === running.key) continue;
    const next = settle(queueRow(r), env, now);
    if (!next) continue;
    await setRowState(r.channel, r.book, next.status, next.reason);
    changed = true;
  }
  if (changed) rows = await listDownloads();

  scheduleRetry(rows);

  if (!running && !suspended) {
    const i = pickNext(rows.map(queueRow), env);
    if (i >= 0) start(rows[i]);
  }
  emit(rows);
  syncSpeedTimer();
}

/** 最早到点的退避重试：到点再 tick 一次。 */
function scheduleRetry(rows: DownloadProgress[]): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const due = rows
    .filter((r) => r.status === "waiting" && r.reason === "retry" && r.nextRetryAt)
    .map((r) => r.nextRetryAt!);
  if (due.length === 0) return;
  const wait = Math.max(500, Math.min(...due) - Date.now());
  retryTimer = setTimeout(kickDownloads, wait);
}

function start(row: DownloadProgress): void {
  const key = downloadKey(row.channel, row.book);
  const meter = new SpeedMeter();
  const job: Running = {
    key,
    channel: row.channel,
    book: row.book,
    stop: null,
    meter,
    finished: Promise.resolve(),
  };
  running = job;
  job.finished = runBook(row.channel, row.book, {
    shouldStop: () => job.stop != null,
    onBlock: (bytes) => {
      meter.add(bytes, Date.now());
      void refreshDownloads();
    },
  })
    .catch(
      (err): RunOutcome => ({
        kind: "failed",
        error: err instanceof Error ? err.message : String(err),
        offline: false,
      }),
    )
    .then((outcome) => finish(job, row, outcome))
    .catch(() => undefined)
    .finally(() => {
      if (running === job) running = null;
      syncSpeedTimer();
      kickDownloads();
    });
}

/** 一本书的循环结束后落状态（循环本身只写进度和 done）。 */
async function finish(
  job: Running,
  row: DownloadProgress,
  outcome: RunOutcome,
): Promise<void> {
  const { channel, book } = job;
  if (outcome.kind === "done") return;

  const stop = job.stop;
  if (stop) {
    if (stop.kind === "discard") return; // 调用方随后删数据
    if (stop.kind === "pause") return setRowState(channel, book, "paused", "user");
    if (stop.kind === "requeue") return setRowState(channel, book, "queued", null);
    return setRowState(channel, book, "waiting", stop.reason);
  }
  if (outcome.kind === "stopped") return setRowState(channel, book, "queued", null);

  // 失败：没网 → 等网络（不算重试次数）；有网 → 退避重试，耗尽转失败。
  await refreshNetwork();
  if (outcome.offline || !env.connected) {
    return setRowState(channel, book, "waiting", "network");
  }
  const attempts = row.attempts + 1;
  const at = retryAt(attempts, Date.now());
  if (at == null) {
    return setRowState(channel, book, "error", null, {
      error: outcome.error,
      attempts,
      nextRetryAt: null,
    });
  }
  return setRowState(channel, book, "waiting", "retry", {
    error: outcome.error,
    attempts,
    nextRetryAt: at,
  });
}

/** 叫停正在跑的这本（若是它），等循环真正退出。 */
async function stopIfRunning(key: string, mode: StopMode): Promise<boolean> {
  const job = running;
  if (!job || job.key !== key) return false;
  job.stop = mode;
  await job.finished;
  return true;
}

// ── 环境 ──

async function refreshNetwork(): Promise<void> {
  try {
    applyNetwork(await Network.getNetworkStateAsync());
  } catch {
    // 拿不到就沿用上次的判断。
  }
}

function applyNetwork(state: Network.NetworkState): void {
  env = {
    ...env,
    // isInternetReachable 偶发 undefined（无法判定），未知不当作离线。
    connected: state.isConnected !== false && state.isInternetReachable !== false,
    cellular: state.type === Network.NetworkStateType.CELLULAR,
  };
}

function applyAppState(state: AppStateStatus): void {
  // iOS 的 inactive 是前后台之间的过渡态（下拉通知中心等），不当作后台。
  const active = state !== "background";
  if (active === env.active) return;
  env = { ...env, active };
  kickDownloads();
}

/**
 * 启动调度器（App 启动、作用域解析完后调一次；重复调用无副作用）：
 * 读设置与网络 → 冷启动对账（downloading → queued）→ 自动续上。
 */
export async function initDownloadManager(): Promise<void> {
  if (started) return;
  started = true;
  const s = await loadDownloadSettings();
  env = { ...env, cellularAllowed: s.cellularAllowed, autoOnWifi: s.autoOnWifi };
  await refreshNetwork();

  const appSub = AppState.addEventListener("change", applyAppState);
  const netSub = Network.addNetworkStateListener((state) => {
    applyNetwork(state);
    kickDownloads();
  });
  unsubs.push(
    () => appSub.remove(),
    () => netSub.remove(),
    onDownloadSettingsChange((next) => {
      env = { ...env, cellularAllowed: next.cellularAllowed, autoOnWifi: next.autoOnWifi };
      kickDownloads();
    }),
    onScopeChange(() => {
      // 新用户库：对账 + 续上（旧库的循环已在 suspendDownloads 里停下）。
      suspended = false;
      void reconcileRows()
        .catch(() => undefined)
        .then(kickDownloads);
    }),
  );

  try {
    await reconcileRows();
  } catch {
    /* 对账失败不影响启动，下一次 tick 自愈 */
  }
  kickDownloads();
}

/** 当前网络是不是移动网络且未允许（发起下载前是否要询问）。 */
export function shouldAskCellular(): boolean {
  const s = getDownloadSettings();
  return env.connected && env.cellular && !s.cellularAllowed;
}

// ── 对外操作 ──

/** 入队（单本或「全部下载」一批）：立刻全部是「排队中」，调度器按顺序逐本下。 */
export async function enqueueDownloads(
  items: EnqueueItem[],
  opts: { batchId?: string; allowCellular?: boolean } = {},
): Promise<void> {
  await enqueueRows(items, opts);
  await tick();
}

/** 用户暂停：跑着的在块边界停下；排队 / 等待中的直接转已暂停。 */
export async function pauseDownload(channel: string, book: number): Promise<void> {
  const key = downloadKey(channel, book);
  if (running?.key === key) {
    running.stop = { kind: "pause" };
    await refreshDownloads();
    return;
  }
  await setStatesWhere(["queued", "waiting"], { status: "paused", reason: "user" }, [
    { channel, book },
  ]);
  await tick();
}

/** 继续 / 重试 / 「已连上 Wi‑Fi，点开始」：回到排队中。 */
export async function resumeDownload(channel: string, book: number): Promise<void> {
  await setStatesWhere(["paused", "error", "waiting"], { status: "queued", reason: null }, [
    { channel, book },
  ]);
  await tick();
}

/** 全部暂停（下载管理 / 频道页批次）：可限定一组书。 */
export async function pauseAllDownloads(
  keys?: { channel: string; book: number }[],
): Promise<void> {
  if (running && (!keys || keys.some((k) => downloadKey(k.channel, k.book) === running!.key))) {
    running.stop = { kind: "pause" };
  }
  await setStatesWhere(["queued", "waiting"], { status: "paused", reason: "user" }, keys);
  await tick();
}

/** 全部继续：已暂停 / 失败的回到排队中。 */
export async function resumeAllDownloads(
  keys?: { channel: string; book: number }[],
): Promise<void> {
  await setStatesWhere(["paused", "error"], { status: "queued", reason: null }, keys);
  await tick();
}

/** 这些书改用移动网络下载（用户明确点的，不再询问）。 */
export async function allowCellular(
  keys: { channel: string; book: number }[],
): Promise<void> {
  await allowCellularRows(keys);
  await tick();
}

/** 置顶：排到队首；正在跑别的书时让出（那本回排队，按游标续传）。 */
export async function moveDownloadToTop(channel: string, book: number): Promise<void> {
  await moveRowToTop(channel, book);
  const key = downloadKey(channel, book);
  if (running && running.key !== key && !running.stop) {
    running.stop = { kind: "requeue" };
  }
  await tick();
}

/** 取消下载：停下并清掉已下数据（没同步过的连记录一起删）。 */
export async function cancelDownload(channel: string, book: number): Promise<void> {
  await stopIfRunning(downloadKey(channel, book), { kind: "discard" });
  await cancelDownloadRows(channel, book);
  await tick();
}

/** 仅删除下载数据（保留下载记录）。 */
export async function clearDownloadData(channel: string, book: number): Promise<void> {
  await stopIfRunning(downloadKey(channel, book), { kind: "discard" });
  await clearDownloadRows(channel, book);
  await tick();
}

/** 删除下载数据和下载记录（登录用户同步删除服务器记录）。 */
export async function removeDownload(channel: string, book: number): Promise<void> {
  await stopIfRunning(downloadKey(channel, book), { kind: "discard" });
  await removeDownloadRows(channel, book);
  await tick();
}

/**
 * 切换用户 / 退出前：停下当前循环（回排队，保留游标），不再开新的，直到作用域切换完成
 * （`onScopeChange` 里解除）或调用 `resumeDownloads`。防止旧账号的循环写进新账号的库。
 */
export async function suspendDownloads(): Promise<void> {
  suspended = true;
  const job = running;
  if (job) {
    job.stop = { kind: "requeue" };
    await job.finished;
  }
}

/** 解除 `suspendDownloads`（作用域没变时用，例如登录失败）。 */
export function resumeDownloads(): void {
  if (!suspended) return;
  suspended = false;
  kickDownloads();
}

// 开发时 Fast Refresh 会重新执行本模块，得到一个新的调度器实例：旧实例的循环要停下
// （回排队，按游标续传）、监听要退订，否则两个调度器会同时写库，违反单写者原则。
declare const module: { hot?: { dispose(cb: () => void): void } } | undefined;
const hot = typeof module !== "undefined" ? module?.hot : undefined;
const HOT_FLAG = "__wikipaliDownloadsReplaced";
hot?.dispose(() => {
  (globalThis as Record<string, unknown>)[HOT_FLAG] = true;
  disposed = true;
  if (running) running.stop = { kind: "requeue" };
  for (const off of unsubs.splice(0)) off();
  if (retryTimer) clearTimeout(retryTimer);
  if (speedTimer) clearInterval(speedTimer);
  listeners.clear();
});
// 新实例接替被替换的旧实例：调用方（AuthProvider）不一定会重新挂载，这里自己启动。
if ((globalThis as Record<string, unknown>)[HOT_FLAG]) {
  delete (globalThis as Record<string, unknown>)[HOT_FLAG];
  void initDownloadManager().catch(() => undefined);
}
