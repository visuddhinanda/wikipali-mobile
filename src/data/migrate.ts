/**
 * 旧数据迁移（AsyncStorage → 当前用户 SQLite）。
 *
 * 多用户支持上线前，阅读记录 / 收藏 / 书签用 AsyncStorage 存 JSON。
 * 升级后把它们一次性搬进**游客**库（旧数据属「上一个单用户」，即游客），
 * 之后登录时再按 `mergeGuestIntoUser` 并入账户。只跑一次（AsyncStorage flag 标记）。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { openReadingDbFor } from "../reading/db";
import { getDeviceUuid } from "../user/deviceUuid";

const DONE_KEY = "@wikipali/legacy-migrated";
const HISTORY_KEY = "@wikipali/reading-history";
const BOOKMARKS_KEY = "@wikipali/bookmarks";
const STARRED_KEY = "@wikipali/starred-books";

let running: Promise<void> | null = null;

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function migrateLegacyAsyncStorage(): Promise<void> {
  if (!running) {
    running = (async () => {
      try {
        if (await AsyncStorage.getItem(DONE_KEY)) return;
        const guestId = await getDeviceUuid();
        const db = await openReadingDbFor(guestId);
        try {
          await db.withTransactionAsync(async () => {
            await migrateHistory(db, parseArray(await AsyncStorage.getItem(HISTORY_KEY)));
            await migrateBookmarks(db, parseArray(await AsyncStorage.getItem(BOOKMARKS_KEY)));
            await migrateStarred(db, parseArray(await AsyncStorage.getItem(STARRED_KEY)));
          });
        } finally {
          await db.closeAsync();
        }
        await AsyncStorage.multiRemove([HISTORY_KEY, BOOKMARKS_KEY, STARRED_KEY]);
        await AsyncStorage.setItem(DONE_KEY, "1");
      } catch {
        running = null; // 失败下次再试
        throw new Error("legacy migration failed");
      }
    })();
  }
  return running;
}

interface LegacyRecord {
  book?: unknown;
  paragraph?: unknown;
  title?: unknown;
  heading?: unknown;
  channelId?: unknown;
  updatedAt?: unknown;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function migrateHistory(
  db: import("expo-sqlite").SQLiteDatabase,
  rows: unknown[],
): Promise<void> {
  const byBook = new Map<number, LegacyRecord>();
  for (const r of rows as LegacyRecord[]) {
    const book = num(r.book);
    if (book == null || typeof r.title !== "string") continue;
    const prev = byBook.get(book);
    if (!prev || num(r.updatedAt ?? 0)! > num(prev.updatedAt ?? 0)!) {
      byBook.set(book, r);
    }
  }
  for (const [book, r] of byBook) {
    await db.runAsync(
      `INSERT OR REPLACE INTO reading_history
         (book, paragraph, title, heading, channel_id, updated_at, server_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        book,
        num(r.paragraph) ?? 0,
        r.title as string,
        typeof r.heading === "string" ? r.heading : null,
        typeof r.channelId === "string" ? r.channelId : null,
        num(r.updatedAt) ?? Date.now(),
      ],
    );
  }
}

async function migrateBookmarks(
  db: import("expo-sqlite").SQLiteDatabase,
  rows: unknown[],
): Promise<void> {
  for (const r of rows as LegacyRecord[]) {
    const book = num(r.book);
    const paragraph = num(r.paragraph);
    if (book == null || paragraph == null || typeof r.title !== "string") continue;
    await db.runAsync(
      `INSERT OR REPLACE INTO bookmarks
         (book, paragraph, title, heading, channel_id, updated_at, server_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        book,
        paragraph,
        r.title as string,
        typeof r.heading === "string" ? r.heading : null,
        typeof r.channelId === "string" ? r.channelId : null,
        num(r.updatedAt) ?? Date.now(),
      ],
    );
  }
}

async function migrateStarred(
  db: import("expo-sqlite").SQLiteDatabase,
  rows: unknown[],
): Promise<void> {
  for (const r of rows as LegacyRecord[]) {
    const book = num(r.book);
    if (book == null || typeof r.title !== "string") continue;
    await db.runAsync(
      `INSERT OR REPLACE INTO starred
         (book, paragraph, title, channel_id, updated_at, server_id)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [
        book,
        num(r.paragraph),
        r.title as string,
        typeof r.channelId === "string" ? r.channelId : null,
        num(r.updatedAt) ?? Date.now(),
      ],
    );
  }
}
