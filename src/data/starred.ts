/**
 * 收藏的书（本地 SQLite，多用户）。
 *
 * 存在当前用户 `reading.db3` 的 `starred` 表。收藏以「书」为粒度：同一本书只保留
 * 一条。写入/删除入队 `sync_outbox`，联网后同步到服务器 `likes`（type=favorite）。
 * 契约见 `docs/multi-user-sync.md` §6.2。
 */
import { openReadingDb, withReadingTransaction } from "../reading/db";
import { localKey, outboxDelete, outboxUpsert } from "./queue";

export interface StarredBook {
  /** 书 id。 */
  book: number;
  /** 收藏时的段落（用于解析作品名与层次 tag，也用于映射服务器 target）。 */
  paragraph?: number;
  /** 作品名（level=1 toc）。 */
  title: string;
  /** 收藏时用的版本 uid（只存 uid，显示名查 channels 表）。 */
  channelId?: string;
  /** 收藏时间（epoch ms）。 */
  updatedAt: number;
}

/** 最多保留的收藏条数。 */
const MAX_RECORDS = 200;

interface Row {
  book: number;
  paragraph: number | null;
  title: string;
  channel_id: string | null;
  updated_at: number;
}

function toRecord(r: Row): StarredBook {
  return {
    book: r.book,
    paragraph: r.paragraph ?? undefined,
    title: r.title,
    channelId: r.channel_id ?? undefined,
    updatedAt: r.updated_at,
  };
}

/** 读取全部收藏（按收藏时间倒序）。 */
export async function loadStarred(): Promise<StarredBook[]> {
  try {
    const db = await openReadingDb();
    const rows = await db.getAllAsync<Row>(
      `SELECT book, paragraph, title, channel_id, updated_at
         FROM starred
        ORDER BY updated_at DESC
        LIMIT ?`,
      [MAX_RECORDS],
    );
    return rows.map(toRecord);
  } catch {
    return [];
  }
}

/** 收藏一本书：同一本书只保留一条并置顶；超过上限裁剪最旧的。 */
export async function saveStarred(record: StarredBook): Promise<void> {
  await withReadingTransaction(async (db) => {
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM starred WHERE book = ?",
      [record.book],
    );
    const serverId = prev?.server_id ?? null;
    const updatedAt = Date.now();

    await db.runAsync(
      `INSERT OR REPLACE INTO starred
         (book, paragraph, title, channel_id, updated_at, server_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.book,
        record.paragraph ?? null,
        record.title,
        record.channelId ?? null,
        updatedAt,
        serverId,
      ],
    );
    await db.runAsync(
      `DELETE FROM starred WHERE book NOT IN
         (SELECT book FROM starred ORDER BY updated_at DESC LIMIT ?)`,
      [MAX_RECORDS],
    );
    await outboxUpsert(
      db,
      localKey("favorite", record.book),
      "favorite",
      {
        book: record.book,
        paragraph: record.paragraph ?? null,
        title: record.title,
        channelId: record.channelId ?? null,
        updatedAt,
      },
      serverId,
    );
  });
}

/** 取消收藏一本书。 */
export async function removeStarred(book: number): Promise<void> {
  await withReadingTransaction(async (db) => {
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM starred WHERE book = ?",
      [book],
    );
    await db.runAsync("DELETE FROM starred WHERE book = ?", [book]);
    await outboxDelete(
      db,
      localKey("favorite", book),
      "favorite",
      { book },
      prev?.server_id ?? null,
    );
  });
}

/** 某本书是否已收藏。 */
export async function isStarred(book: number): Promise<boolean> {
  try {
    const db = await openReadingDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) n FROM starred WHERE book = ?",
      [book],
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
