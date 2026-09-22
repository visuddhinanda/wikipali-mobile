/**
 * 书签（本地 SQLite，多用户）。
 *
 * 存在当前用户 `reading.db3` 的 `bookmarks` 表。书签以「书 + 段落」为粒度：
 * 同一本书的同一段只保留一条。写入/删除入队 `sync_outbox`，联网后同步到服务器
 * `likes`（type=bookmark，target_id=progress_chapters.uid）。
 * 契约见 `docs/multi-user-sync.md` §6.2。
 */
import { openReadingDb, withReadingTransaction } from "../reading/db";
import { localKey, outboxDelete, outboxUpsert } from "./queue";

export interface Bookmark {
  /** 书 id。 */
  book: number;
  /** 段落（书签所在位置）。 */
  paragraph: number;
  /** 作品名（level=1 toc）。 */
  title: string;
  /** 当前章节标题（用于副标题展示）。 */
  heading?: string;
  /** 加书签时用的版本 uid。 */
  channelId?: string;
  /** 加书签时间（epoch ms）。 */
  updatedAt: number;
}

/** 最多保留的书签条数。 */
const MAX_RECORDS = 500;

interface Row {
  book: number;
  paragraph: number;
  title: string;
  heading: string | null;
  channel_id: string | null;
  updated_at: number;
}

function toRecord(r: Row): Bookmark {
  return {
    book: r.book,
    paragraph: r.paragraph,
    title: r.title,
    heading: r.heading ?? undefined,
    channelId: r.channel_id ?? undefined,
    updatedAt: r.updated_at,
  };
}

/** 读取全部书签（按时间倒序）。 */
export async function loadBookmarks(): Promise<Bookmark[]> {
  try {
    const db = await openReadingDb();
    const rows = await db.getAllAsync<Row>(
      `SELECT book, paragraph, title, heading, channel_id, updated_at
         FROM bookmarks
        ORDER BY updated_at DESC
        LIMIT ?`,
      [MAX_RECORDS],
    );
    return rows.map(toRecord);
  } catch {
    return [];
  }
}

/** 加书签：同一（书, 段落）只保留一条并置顶；超过上限裁剪最旧的。 */
export async function saveBookmark(record: Bookmark): Promise<void> {
  await withReadingTransaction(async (db) => {
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM bookmarks WHERE book = ? AND paragraph = ?",
      [record.book, record.paragraph],
    );
    const serverId = prev?.server_id ?? null;
    const updatedAt = Date.now();

    await db.runAsync(
      `INSERT OR REPLACE INTO bookmarks
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
      `DELETE FROM bookmarks WHERE (book, paragraph) NOT IN
         (SELECT book, paragraph FROM bookmarks ORDER BY updated_at DESC LIMIT ?)`,
      [MAX_RECORDS],
    );
    await outboxUpsert(
      db,
      localKey("bookmark", record.book, record.paragraph),
      "bookmark",
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

/** 删除一个书签。 */
export async function removeBookmark(
  book: number,
  paragraph: number,
): Promise<void> {
  await withReadingTransaction(async (db) => {
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM bookmarks WHERE book = ? AND paragraph = ?",
      [book, paragraph],
    );
    await db.runAsync("DELETE FROM bookmarks WHERE book = ? AND paragraph = ?", [
      book,
      paragraph,
    ]);
    await outboxDelete(
      db,
      localKey("bookmark", book, paragraph),
      "bookmark",
      { book, paragraph },
      prev?.server_id ?? null,
    );
  });
}

/** 某（书, 段落）是否已加书签。 */
export async function isBookmarked(
  book: number,
  paragraph: number,
): Promise<boolean> {
  try {
    const db = await openReadingDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) n FROM bookmarks WHERE book = ? AND paragraph = ?",
      [book, paragraph],
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
