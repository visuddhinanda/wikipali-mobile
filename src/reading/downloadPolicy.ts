/**
 * 下载调度的纯决策（不碰 RN / SQLite，`scripts/check-download-queue.mjs` 直接跑）。
 *
 * 状态机见 `docs/download-manager.md` §4：
 *   pending → queued → downloading → done
 *   downloading/queued ⇄ waiting(<原因>)   系统原因，条件满足后自动恢复
 *   paused(user)                         只有用户暂停，不自动恢复
 *   error                                自动重试耗尽
 */

export type DownloadStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "waiting"
  | "paused"
  | "done"
  | "error";

/**
 * 等待 / 暂停的原因：
 * - `background` App 在后台（游标通道只能在前台跑）
 * - `network`    没网
 * - `wifi`       在移动网络、未获允许
 * - `wifi_ready` 已连上 Wi‑Fi，但「连上 Wi‑Fi 时自动下载」关着，等用户点开始
 * - `retry`      网络错误，退避到 `next_retry_at` 再试
 * - `user`       用户暂停（只用于 paused）
 */
export type WaitReason =
  | "background"
  | "network"
  | "wifi"
  | "wifi_ready"
  | "retry"
  | "user";

/** 调度时看到的环境。 */
export interface DownloadEnv {
  /** App 在前台。 */
  active: boolean;
  /** 有网络连接。 */
  connected: boolean;
  /** 当前是移动网络。 */
  cellular: boolean;
  /** 设置：使用移动网络下载。 */
  cellularAllowed: boolean;
  /** 设置：连上 Wi‑Fi 时自动下载。 */
  autoOnWifi: boolean;
}

/** 调度需要的那几列。 */
export interface QueueRow {
  status: DownloadStatus;
  reason: WaitReason | null;
  queuePos: number | null;
  allowCellular: boolean;
  nextRetryAt: number | null;
}

/** 自动重试的退避间隔（毫秒）：第 1/2/3 次失败后分别等多久。用完即转 error。 */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** 某本书此刻不能跑的原因；null = 可以跑。 */
export function blocker(
  row: Pick<QueueRow, "allowCellular">,
  env: DownloadEnv,
): WaitReason | null {
  if (!env.active) return "background";
  if (!env.connected) return "network";
  if (env.cellular && !env.cellularAllowed && !row.allowCellular) return "wifi";
  return null;
}

/**
 * 排队中 / 等待中的一行在当前环境下应该变成什么（不变返回 null）。
 * 已暂停、失败、完成、未下载、下载中的行不归这里管。
 */
export function settle(
  row: QueueRow,
  env: DownloadEnv,
  now: number,
): { status: "queued" | "waiting"; reason: WaitReason | null } | null {
  if (row.status !== "queued" && row.status !== "waiting") return null;
  const b = blocker(row, env);

  if (row.status === "waiting" && row.reason === "retry") {
    // 退避期间：环境阻塞优先显示（断网就显示等网络），到点且无阻塞才回排队。
    if (b) return { status: "waiting", reason: b };
    if (row.nextRetryAt != null && now < row.nextRetryAt) return null;
    return { status: "queued", reason: null };
  }
  if (row.status === "waiting" && row.reason === "wifi_ready") {
    // 只等用户点开始；又回到移动网络则重新变成等 Wi‑Fi。
    return b === "wifi" ? { status: "waiting", reason: "wifi" } : null;
  }
  if (b) {
    return row.status === "waiting" && row.reason === b
      ? null
      : { status: "waiting", reason: b };
  }
  if (row.status === "waiting") {
    // 条件满足：等 Wi‑Fi 的看「自动下载」开关，其余直接回排队。
    if (row.reason === "wifi" && !env.autoOnWifi) {
      return { status: "waiting", reason: "wifi_ready" };
    }
    return { status: "queued", reason: null };
  }
  return null;
}

/** 下一本该跑的（queue_pos 最小的 queued 且无阻塞）；没有返回 -1。 */
export function pickNext(rows: QueueRow[], env: DownloadEnv): number {
  let best = -1;
  rows.forEach((r, i) => {
    if (r.status !== "queued" || blocker(r, env)) return;
    if (best < 0 || (r.queuePos ?? Infinity) < (rows[best].queuePos ?? Infinity)) best = i;
  });
  return best;
}

/** 失败第 `attempts` 次后：还能重试就给出下次时间，否则 null（转 error）。 */
export function retryAt(attempts: number, now: number): number | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay == null ? null : now + delay;
}

/**
 * 一次取数失败后该落什么状态：
 * - 系统确实没网 → 等待网络（不计失败次数，联网后自动续）；
 * - 系统说有网、请求却发不出去（服务器不可达 / 明文 HTTP 被拦 / DNS / 认证页）或超时、
 *   HTTP 错误 → 计一次失败，退避重试，耗尽转 error。
 *   **不能**把「有网却发不出去」也当等网络：调度器看到有网会立刻重排，原地空转。
 */
export function afterFailure(
  offline: boolean,
  connected: boolean,
  attempts: number,
  now: number,
):
  | { status: "waiting"; reason: "network"; attempts: number; nextRetryAt: null }
  | { status: "waiting"; reason: "retry"; attempts: number; nextRetryAt: number }
  | { status: "error"; reason: null; attempts: number; nextRetryAt: null } {
  if (offline && !connected) {
    return { status: "waiting", reason: "network", attempts, nextRetryAt: null };
  }
  const next = attempts + 1;
  const at = retryAt(next, now);
  return at == null
    ? { status: "error", reason: null, attempts: next, nextRetryAt: null }
    : { status: "waiting", reason: "retry", attempts: next, nextRetryAt: at };
}

/**
 * 速度采样：最近 `windowMs` 内的字节 / 时长，再做一次 EMA 平滑（α=0.3），
 * 免得一块一块地跳。
 */
export class SpeedMeter {
  private samples: [number, number][] = [];
  private ema = 0;
  private readonly windowMs: number;

  constructor(windowMs = 5_000) {
    this.windowMs = windowMs;
  }

  add(bytes: number, at: number): void {
    this.samples.push([at, bytes]);
    this.samples = this.samples.filter(([t]) => at - t <= this.windowMs);
    const first = this.samples[0][0];
    const span = Math.max(1_000, at - first);
    const raw = (this.samples.reduce((s, [, b]) => s + b, 0) / span) * 1_000;
    this.ema = this.ema ? this.ema * 0.7 + raw * 0.3 : raw;
  }

  /** 字节 / 秒；超过一个窗口没有新样本视为停了。 */
  speed(at: number): number {
    const last = this.samples[this.samples.length - 1];
    if (!last || at - last[0] > this.windowMs) return 0;
    return this.ema;
  }
}

/** 剩余字节估算：没有服务端总量时按「已下字节 / 已下段数 × 总段数」。 */
export function estimateTotalBytes(
  bytes: number,
  done: number,
  total: number,
): number | null {
  if (bytes <= 0 || done <= 0 || total <= 0) return null;
  return Math.max(bytes, Math.round((bytes / done) * total));
}
