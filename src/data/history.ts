/**
 * 阅读记录（本地 SQLite，多用户）。
 *
 * 存在当前用户 `reading.db3` 的 `reading_history` 表（每用户一份库）。
 * 写入时同步入队 `sync_outbox`，联网后由 `src/data/sync.ts` 推送到服务器 `recents`。
 * 契约见 `docs/multi-user-sync.md` §6.1。
 *
 * 接口签名保持不变，上层（书架「在读」、阅读器）无需改动。
 */
import { openReadingDb, withReadingTransaction } from "../reading/db";
import { localKey, outboxRemove, outboxUpsert } from "./queue";

export interface ReadingRecord {
  /** 书 id。 */
  book: number;
  /** 段落（当前显示单元起始段）。 */
  paragraph: number;
  /** 书名（阅读器 route title；无书名时回退 `book-paragraph`）。 */
  title: string;
  /** 当前章节标题（用于副标题展示）。 */
  heading?: string;
  /** 阅读时使用的版本 uid（只存 uid，显示名查 channels 表）。 */
  channelId?: string;
  /** @deprecated 旧数据里的版本名快照，只读不写；显示一律查 `channels` 表。 */
  channelName?: string;
  /** 最近阅读时间（epoch ms）。 */
  updatedAt: number;
}

/** 最多保留的记录条数，超出后丢弃最旧的。 */
const MAX_RECORDS = 100;

interface Row {
  book: number;
  paragraph: number;
  title: string;
  heading: string | null;
  channel_id: string | null;
  updated_at: number;
}

function toRecord(r: Row): ReadingRecord {
  return {
    book: r.book,
    paragraph: r.paragraph,
    title: r.title,
    heading: r.heading ?? undefined,
    channelId: r.channel_id ?? undefined,
    updatedAt: r.updated_at,
  };
}

/** 读取全部阅读记录（按最近阅读时间倒序；同一本书只保留最后一次位置）。 */
export async function loadReadingHistory(): Promise<ReadingRecord[]> {
  try {
    const db = await openReadingDb();
    const rows = await db.getAllAsync<Row>(
      `SELECT book, paragraph, title, heading, channel_id, updated_at
         FROM reading_history
        ORDER BY updated_at DESC
        LIMIT ?`,
      [MAX_RECORDS],
    );
    return rows.map(toRecord);
  } catch {
    return [];
  }
}

/**
 * 写入一条阅读记录：同一本书（book）只保留一条（更新为最后一次的位置与版本），
 * 并置顶到列表最前；超过上限则裁剪最旧的。同时入队待同步。
 */
export async function saveReadingRecord(record: ReadingRecord): Promise<void> {
  await withReadingTransaction(async (db) => {
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM reading_history WHERE book = ?",
      [record.book],
    );
    const serverId = prev?.server_id ?? null;
    const updatedAt = Date.now();

    await db.runAsync(
      `INSERT OR REPLACE INTO reading_history
         (book, paragraph, title, heading, channel_id, updated_at, server_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.book,
        record.paragraph,
        record.title,
        record.heading ?? null,
        record.channelId ?? null,
        updatedAt,
        serverId,
      ],
    );
    await db.runAsync(
      `DELETE FROM reading_history WHERE book NOT IN
         (SELECT book FROM reading_history ORDER BY updated_at DESC LIMIT ?)`,
      [MAX_RECORDS],
    );
    await outboxUpsert(
      db,
      localKey("reading", record.book),
      "reading",
      {
        book: record.book,
        paragraph: record.paragraph,
        title: record.title,
        heading: record.heading ?? null,
        channelId: record.channelId ?? null,
        updatedAt,
      },
      serverId,
    );
  });
}

/** 清空阅读记录（仅本地；服务器无 recent 删除接口，见 docs/multi-user-sync.md §10 缺口 3）。 */
export async function clearReadingHistory(): Promise<void> {
  await withReadingTransaction(async (db) => {
    const rows = await db.getAllAsync<{ book: number }>(
      "SELECT book FROM reading_history",
    );
    await db.runAsync("DELETE FROM reading_history");
    for (const r of rows) {
      await outboxRemove(db, localKey("reading", r.book));
    }
  });
}
