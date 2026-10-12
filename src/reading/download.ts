/**
 * 整本书离线下载的**存储层 + 单本下载循环**（见 `docs/reading-content.md` §4.4、
 * `docs/download-manager.md`）。排队、并发、前后台 / 网络切换由
 * `downloadManager.ts` 的调度器负责，本文件不持有任何全局运行状态。
 *
 * 取数走 `/v3/tipitaka-reading/{channel}`：`book` 过滤 + 不透明游标一块块取，每块写回
 * `para_html`。分母取 `meta.total`（本书有译文的段数）。断点续传 = `download_state.cursor`。
 *
 * `download_state` 是队列的唯一真源：排队顺序 `queue_pos`、等待原因 `pause_reason`、
 * 锚点段 `anchor_para` 都落库，进程被杀后原样恢复。
 */
import { DOWNLOAD_PAGE_SIZE } from "../api/read-chapter";
import { cachedParaCount, fetchChapterBlock } from "./cache";
import {
  tipitakaRunner,
  withReadingTransaction,
  withReadingWrite,
  type SqlDb,
} from "./db";
import { firstReadingParagraph, level1ParagraphOf } from "./unit";
import { localKey, outboxDelete, outboxUpsert } from "../data/queue";
import type { DownloadStatus, WaitReason } from "./downloadPolicy";

export type { DownloadStatus, WaitReason } from "./downloadPolicy";

export interface DownloadProgress {
  channel: string;
  book: number;
  status: DownloadStatus;
  /** 等待 / 暂停原因（`waiting` / `paused` 时有值）。 */
  reason: WaitReason | null;
  /**
   * 分母：该版本在本书**有译文**的段落总数（游标接口的 `meta.total`）。
   * 还没开工、拿不到接口数字时退化成本书的段落总数，开工后立刻被真值替换。
   */
  total: number;
  /** 分子：已缓存到有正文的段数。 */
  done: number;
  /** 已传输字节（续传累加）。 */
  bytes: number;
  error?: string | null;
  updatedAt: number;
  /** 排队顺序（越小越先）。 */
  queuePos: number | null;
  /** 「全部下载」批次 id。 */
  batchId: string | null;
  /** 用户点过「立即下载」/「使用移动网络下载」：本书在移动网络下也照常下。 */
  allowCellular: boolean;
  /** 连续失败次数。 */
  attempts: number;
  /** 退避到点时间（epoch ms）。 */
  nextRetryAt: number | null;
  /** 发起下载时所在段（同步锚点向上搜到 level=1 用）。 */
  anchorPara: number | null;
}

/** 百分比（0–100，整数）。 */
export function percent(p: Pick<DownloadProgress, "total" | "done">): number {
  if (p.total <= 0) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
}

/**
 * 该书段落总数（只读库，离线可算）——**分母的兜底值**。
 *
 * 真正的分母是「该版本有译文的段数」，只有联网问过游标接口才知道；一次都没
 * 下载过的书拿不到，先用本书段落总数顶着，开工后第一块就会换成真值。
 */
async function totalParas(book: number): Promise<number> {
  const sql = await tipitakaRunner();
  const rows = await sql.all<{ n: number }>(
    "SELECT count(*) n FROM pali_text WHERE book = ?",
    [book],
  );
  return rows[0]?.n ?? 0;
}

interface StateRow {
  channel: string;
  book: number;
  status: DownloadStatus;
  total: number;
  done: number;
  error: string | null;
  updated_at: number;
  pause_reason: WaitReason | null;
  queue_pos: number | null;
  batch_id: string | null;
  bytes: number | null;
  attempts: number | null;
  next_retry_at: number | null;
  anchor_para: number | null;
  allow_cellular: number | null;
}

const STATE_COLUMNS = `channel, book, status, total, done, error, updated_at, pause_reason,
  queue_pos, batch_id, bytes, attempts, next_retry_at, anchor_para, allow_cellular`;

function toProgress(r: StateRow): DownloadProgress {
  return {
    channel: r.channel,
    book: r.book,
    status: r.status,
    reason: r.pause_reason ?? null,
    total: r.total,
    done: r.done,
    bytes: r.bytes ?? 0,
    error: r.error,
    updatedAt: r.updated_at,
    queuePos: r.queue_pos,
    batchId: r.batch_id,
    allowCellular: (r.allow_cellular ?? 0) > 0,
    attempts: r.attempts ?? 0,
    nextRetryAt: r.next_retry_at,
    anchorPara: r.anchor_para,
  };
}

/** 读一本书的下载状态；没有记录时按已缓存段数现算。 */
export function getDownloadProgress(
  channelId: string,
  book: number,
): Promise<DownloadProgress> {
  // 读也持连接锁，不读到下载事务的中间态（并发模型见 reading/db.ts）。
  return withReadingWrite(async (db) => {
    const row = await db.getFirstAsync<StateRow>(
      `SELECT ${STATE_COLUMNS} FROM download_state WHERE channel = ? AND book = ?`,
      [channelId, book],
    );
    if (row) return toProgress(row);
    const doneRow = await db.getFirstAsync<{ n: number }>(
      "SELECT count(html) n FROM para_html WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    return {
      channel: channelId,
      book,
      status: "pending",
      reason: null,
      total: await totalParas(book),
      done: doneRow?.n ?? 0,
      bytes: 0,
      updatedAt: 0,
      queuePos: null,
      batchId: null,
      allowCellular: false,
      attempts: 0,
      nextRetryAt: null,
      anchorPara: null,
    };
  });
}

/** 全部下载记录（下载管理 / 书架「已下载」）。 */
export function listDownloads(): Promise<DownloadProgress[]> {
  return withReadingWrite(async (db) => {
    const rows = await db.getAllAsync<StateRow>(
      `SELECT ${STATE_COLUMNS} FROM download_state ORDER BY updated_at DESC`,
    );
    return rows.map(toProgress);
  });
}

export interface EnqueueItem {
  channel: string;
  book: number;
  /** 发起下载时所在段（同步锚点）；没有就沿用记录里的。 */
  anchorPara?: number;
}

/**
 * 批量入队（一个事务）：每本书立刻是 `queued`，排在队尾。
 * 已下完 / 正在下的跳过；`allowCellular` 只会置上、不会清掉。
 */
export async function enqueueRows(
  items: EnqueueItem[],
  opts: { batchId?: string | null; allowCellular?: boolean } = {},
): Promise<void> {
  if (items.length === 0) return;
  await withReadingTransaction(async (db) => {
    const max = await db.getFirstAsync<{ n: number | null }>(
      "SELECT max(queue_pos) n FROM download_state",
    );
    let pos = (max?.n ?? 0) + 1;
    const now = Date.now();
    for (const it of items) {
      const cur = await db.getFirstAsync<{ status: DownloadStatus }>(
        "SELECT status FROM download_state WHERE channel = ? AND book = ?",
        [it.channel, it.book],
      );
      if (cur?.status === "done" || cur?.status === "downloading") continue;
      const done = await db.getFirstAsync<{ n: number }>(
        "SELECT count(html) n FROM para_html WHERE channel = ? AND book = ?",
        [it.channel, it.book],
      );
      await db.runAsync(
        `INSERT INTO download_state
           (channel, book, status, total, done, error, updated_at, cursor, pause_reason,
            queue_pos, batch_id, bytes, attempts, next_retry_at, anchor_para, allow_cellular)
         VALUES (?, ?, 'queued', 0, ?, NULL, ?, NULL, NULL, ?, ?, 0, 0, NULL, ?, ?)
         ON CONFLICT(channel, book) DO UPDATE SET
           status = 'queued', error = NULL, pause_reason = NULL, attempts = 0,
           next_retry_at = NULL, updated_at = excluded.updated_at,
           queue_pos = excluded.queue_pos,
           batch_id = coalesce(excluded.batch_id, batch_id),
           anchor_para = coalesce(excluded.anchor_para, anchor_para),
           allow_cellular = max(allow_cellular, excluded.allow_cellular)`,
        [
          it.channel,
          it.book,
          done?.n ?? 0,
          now,
          pos++,
          opts.batchId ?? null,
          it.anchorPara ?? null,
          opts.allowCellular ? 1 : 0,
        ],
      );
    }
  });
}

/** 改一本书的状态 / 原因（以及可选的其它列）。 */
export async function setRowState(
  channelId: string,
  book: number,
  status: DownloadStatus,
  reason: WaitReason | null,
  extra: { error?: string | null; attempts?: number; nextRetryAt?: number | null } = {},
): Promise<void> {
  const sets = ["status = ?", "pause_reason = ?", "updated_at = ?"];
  const params: (string | number | null)[] = [status, reason, Date.now()];
  if (extra.error !== undefined) (sets.push("error = ?"), params.push(extra.error));
  if (extra.attempts !== undefined) (sets.push("attempts = ?"), params.push(extra.attempts));
  if (extra.nextRetryAt !== undefined) {
    sets.push("next_retry_at = ?");
    params.push(extra.nextRetryAt);
  }
  await withReadingWrite((db) =>
    db.runAsync(
      `UPDATE download_state SET ${sets.join(", ")} WHERE channel = ? AND book = ?`,
      [...params, channelId, book],
    ),
  );
}

/** 批量改状态：把 `from` 里任一状态的行改成 `to`（可限定一组书）。 */
export async function setStatesWhere(
  from: DownloadStatus[],
  to: { status: DownloadStatus; reason: WaitReason | null },
  keys?: { channel: string; book: number }[],
): Promise<void> {
  const inList = from.map(() => "?").join(",");
  await withReadingTransaction(async (db) => {
    const base = `UPDATE download_state SET status = ?, pause_reason = ?, attempts = 0,
      next_retry_at = NULL, updated_at = ? WHERE status IN (${inList})`;
    const head = [to.status, to.reason, Date.now(), ...from];
    if (!keys) {
      await db.runAsync(base, head);
      return;
    }
    for (const k of keys) {
      await db.runAsync(`${base} AND channel = ? AND book = ?`, [...head, k.channel, k.book]);
    }
  });
}

/** 把一组书标成允许移动网络（「使用移动网络下载」），等 Wi‑Fi 的回到排队。 */
export async function allowCellularRows(
  keys: { channel: string; book: number }[],
): Promise<void> {
  await withReadingTransaction(async (db) => {
    for (const k of keys) {
      await db.runAsync(
        `UPDATE download_state SET allow_cellular = 1,
           status = CASE WHEN status = 'waiting' THEN 'queued' ELSE status END,
           pause_reason = CASE WHEN status = 'waiting' THEN NULL ELSE pause_reason END,
           updated_at = ?
         WHERE channel = ? AND book = ?`,
        [Date.now(), k.channel, k.book],
      );
    }
  });
}

/** 置顶：排到队首；已暂停的顺带回排队。 */
export async function moveRowToTop(channelId: string, book: number): Promise<void> {
  await withReadingTransaction(async (db) => {
    const min = await db.getFirstAsync<{ n: number | null }>(
      "SELECT min(queue_pos) n FROM download_state",
    );
    await db.runAsync(
      `UPDATE download_state SET queue_pos = ?,
         status = CASE WHEN status = 'paused' THEN 'queued' ELSE status END,
         pause_reason = CASE WHEN status = 'paused' THEN NULL ELSE pause_reason END,
         updated_at = ?
       WHERE channel = ? AND book = ?`,
      [(min?.n ?? 1) - 1, Date.now(), channelId, book],
    );
  });
}

/**
 * 冷启动 / 切回该用户时的对账：上次没跑完的 `downloading` → `queued`（按游标续传），
 * 后台 / 网络这类系统等待也回 `queued`，交给调度器按当前环境重新判定。
 * 用户暂停的 `paused` 不动。
 */
export async function reconcileRows(): Promise<void> {
  await withReadingWrite((db) =>
    db.runAsync(
      `UPDATE download_state SET status = 'queued', pause_reason = NULL, updated_at = ?
        WHERE status = 'downloading'
           OR (status = 'waiting' AND pause_reason IN ('background', 'network', 'wifi'))`,
      [Date.now()],
    ),
  );
}

/**
 * 仅删除下载的正文数据：清 `para_html`，`download_state` 改回 `pending`（保留记录）。
 * 服务器上的 download reaction **不动**。调用前须先停掉这本书的下载循环。
 */
export async function clearDownloadRows(
  channelId: string,
  book: number,
): Promise<void> {
  await withReadingTransaction(async (db) => {
    await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
      channelId,
      book,
    ]);
    await db.runAsync(
      `UPDATE download_state SET status = 'pending', total = 0, done = 0, error = NULL,
         cursor = NULL, pause_reason = NULL, bytes = 0, attempts = 0, next_retry_at = NULL,
         queue_pos = NULL, batch_id = NULL, allow_cellular = 0
        WHERE channel = ? AND book = ?`,
      [channelId, book],
    );
  });
}

/**
 * 删除下载数据 + 下载记录：清 `para_html`、删 `download_state`，并入队服务器
 * download reaction 的 delete 墓碑（登录后由 `syncNow` 删除服务器记录）。
 * 调用前须先停掉这本书的下载循环。
 */
export async function removeDownloadRows(
  channelId: string,
  book: number,
): Promise<void> {
  await withReadingTransaction(async (db) => {
    await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
      channelId,
      book,
    ]);
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    await db.runAsync(
      "DELETE FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    await outboxDelete(
      db,
      localKey("download", book, undefined, channelId),
      "download",
      { channel: channelId, book },
      prev?.server_id ?? null,
    );
  });
}

/**
 * 取消下载（下载管理「取消下载」）：清掉已下的正文。从没同步过的记录（没有
 * `server_id`）连行一起删，回到「未下载」；同步过的保留记录（同「仅删除下载数据」）。
 * 调用前须先停掉这本书的下载循环。
 */
export async function cancelDownloadRows(
  channelId: string,
  book: number,
): Promise<void> {
  const row = await withReadingWrite((db) =>
    db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    ),
  );
  if (row?.server_id) return clearDownloadRows(channelId, book);
  await withReadingTransaction(async (db) => {
    await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
      channelId,
      book,
    ]);
    await db.runAsync(
      "DELETE FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    );
  });
}

/** 下载完成时入队一条下载记录同步（幂等，local_key 唯一）。 */
async function enqueueDownloadSync(
  db: SqlDb,
  channel: string,
  book: number,
  anchorParagraph: number | null,
): Promise<void> {
  const prev = await db.getFirstAsync<{ server_id: string | null }>(
    "SELECT server_id FROM download_state WHERE channel = ? AND book = ?",
    [channel, book],
  );
  // 下载是书级操作：锚定 level=1 段（progress_chapters 里 para 指向 level=1 的行就是「书」）。
  // 从「下载时所在段」向上搜索到 level=1；没有则退回第一个 level=1。
  const sql = await tipitakaRunner();
  const raw = anchorParagraph ?? (await firstReadingParagraph(sql, book));
  const paragraph =
    raw != null ? await level1ParagraphOf(sql, book, raw) : null;
  await outboxUpsert(
    db,
    localKey("download", book, undefined, channel),
    "download",
    { channel, book, paragraph, updatedAt: Date.now() },
    prev?.server_id ?? null,
  );
}

/**
 * 下载循环的兜底上限：防御服务端游标不推进时空转。正常一本书按 5000 字节一块
 * 几百块就取完了，这个上限只在数据异常时兜底。
 */
const MAX_DOWNLOAD_BLOCKS = 50000;

export type RunOutcome =
  | { kind: "done" }
  /** 被调度器叫停（暂停 / 后台 / 断网 / 删除 / 切用户），状态由调度器写。 */
  | { kind: "stopped" }
  /** 取数失败；`offline` = fetch 本身没发出去（没网）。 */
  | { kind: "failed"; error: string; offline: boolean };

export interface RunControl {
  /** 每块边界检查一次：返回 true 即停（当前块已落库）。 */
  shouldStop: () => boolean;
  /** 每块**落库后**回报本块字节数（调度器据此测速、刷新快照）。 */
  onBlock: (bytes: number) => void;
}

/**
 * 跑一本书：从游标续传，逐块取数写库，直到取完 / 被叫停 / 失败。
 * 只在 `downloadManager` 的单写者调度下调用（同一时刻最多一个）。
 */
export async function runBook(
  channelId: string,
  book: number,
  ctl: RunControl,
): Promise<RunOutcome> {
  const stored = await withReadingWrite((db) =>
    db.getFirstAsync<{
      total: number;
      cursor: string | null;
      bytes: number | null;
      anchor_para: number | null;
    }>(
      "SELECT total, cursor, bytes, anchor_para FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    ),
  );
  let total = stored?.total || (await totalParas(book));
  let cursor = stored?.cursor ?? null;
  let bytes = stored?.bytes ?? 0;
  const anchor = stored?.anchor_para ?? null;

  const save = (done: number) =>
    withReadingWrite((db) =>
      db.runAsync(
        `UPDATE download_state SET status = 'downloading', pause_reason = NULL, total = ?,
           done = ?, bytes = ?, cursor = ?, error = NULL, updated_at = ?
         WHERE channel = ? AND book = ?`,
        [total, done, bytes, cursor, Date.now(), channelId, book],
      ),
    );

  await save(await cachedParaCount(channelId, book));

  for (let n = 0; n < MAX_DOWNLOAD_BLOCKS; n++) {
    if (ctl.shouldStop()) return { kind: "stopped" };

    let block;
    try {
      block = await fetchChapterBlock(channelId, book, cursor, DOWNLOAD_PAGE_SIZE);
    } catch (err) {
      return {
        kind: "failed",
        error: err instanceof Error ? err.message : String(err),
        offline: false,
      };
    }
    if (!block) return { kind: "failed", error: "offline", offline: true };
    // 分母取 meta.total（本书有译文的段数），首块拿到即固定。
    if (block.total != null) total = block.total;
    bytes += block.bytes;
    cursor = block.nextCursor; // null = 取完

    if (cursor == null) {
      // 分子按「渲染出正文的段」数，分母按服务端的「有译文的段」数 —— 个别段
      // 在服务端有句子、渲染出来却是空的，会差上几段。整本取完就按满算，
      // 否则进度条永远停在 99%。完成与入队同步放同一个事务。
      await withReadingTransaction(async (db) => {
        await db.runAsync(
          `UPDATE download_state SET status = 'done', pause_reason = NULL, total = ?, done = ?,
             bytes = ?, cursor = NULL, error = NULL, attempts = 0, next_retry_at = NULL,
             updated_at = ?
           WHERE channel = ? AND book = ?`,
          [total, total, bytes, Date.now(), channelId, book],
        );
        await enqueueDownloadSync(db, channelId, book, anchor);
      });
      ctl.onBlock(block.bytes);
      return { kind: "done" };
    }
    await save(await cachedParaCount(channelId, book));
    ctl.onBlock(block.bytes);
  }
  return {
    kind: "failed",
    error: `download: book ${book} 取数块数超上限`,
    offline: false,
  };
}
