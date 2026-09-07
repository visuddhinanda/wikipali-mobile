/**
 * 阅读链路的两个数据库（见 `docs/reading-content.md` §4.1）。
 *
 * | 文件           | 用途                 | 读写 | 来源 |
 * |----------------|----------------------|------|------|
 * | `tipitaka.db3` | 章节树 / `pali_text` | 只读 | 打包在 assets，随版本整体替换 |
 * | `reading.db3`  | 正文缓存 + 下载状态  | 读写 | 首次启动建表 |
 *
 * 分开的理由：`tipitaka.db3` 是随 App 版本替换的只读资产，一旦混入用户数据，
 * 每次更新都要做数据迁移；分开后更新只是覆盖文件，用户缓存不受影响。
 */
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import type { SqlRunner } from "../catalog/commentary";

/** expo-sqlite 打开数据库时使用的目录（`Paths.document/SQLite`）。 */
const DB_DIR = "SQLite";

const TIPITAKA_DB = "tipitaka.db3";
const READING_DB = "reading.db3";

/** 把 `SQLiteDatabase` 适配成 `SqlRunner`（与 `commentary.ts` 共用的接口）。 */
export function toRunner(db: SQLite.SQLiteDatabase): SqlRunner {
  return {
    all: <T = unknown,>(sql: string, params: unknown[]) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
  };
}

let tipitakaPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let readingPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 把打包的 `assets/db/tipitaka.db3`（46 MB）拷到 expo-sqlite 的目录。
 *
 * 只在目标文件不存在时拷贝。App 更新带来的新数据库由 `meta.generated_at`
 * 比对后覆盖，见 `refreshTipitakaDbIfStale()`。
 */
async function ensureTipitakaFile(force = false): Promise<void> {
  const dir = new Directory(Paths.document, DB_DIR);
  if (!dir.exists) dir.create({ intermediates: true });

  const target = new File(dir, TIPITAKA_DB);
  if (target.exists && !force) return;
  if (target.exists) target.delete();

  const asset = Asset.fromModule(require("../../assets/db/tipitaka.db3"));
  await asset.downloadAsync();
  if (!asset.localUri) {
    throw new Error("离线目录数据库不可用：资源未解包（localUri 为空）");
  }
  const source = new File(asset.localUri);
  source.copy(target);

  // release 构建里资源来自 APK 的 res/raw，拷贝失败时只会留下 0 字节文件，
  // SQLite 把它当成空库打开，报的是「no such table」而不是拷贝错误 ——
  // 这里当场比一次大小，把真正的原因暴露出来。
  if (target.size !== source.size) {
    throw new Error(
      `离线目录数据库拷贝不完整：${target.size}/${source.size} 字节（${asset.localUri}）`,
    );
  }
}

/** 打开的库里到底有没有正文表 —— 空文件也能被 SQLite 正常打开。 */
async function hasPaliText(db: SQLite.SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name = 'pali_text'",
  );
  return (row?.n ?? 0) > 0;
}

/** 只读的三藏目录库（`pali_text`）。 */
export function openTipitakaDb(): Promise<SQLite.SQLiteDatabase> {
  if (!tipitakaPromise) {
    tipitakaPromise = (async () => {
      await ensureTipitakaFile();
      let db = await SQLite.openDatabaseAsync(TIPITAKA_DB);
      if (!(await hasPaliText(db))) {
        // 文件在但表不在 = 上次拷贝留下了半截/空文件，重拷一次自愈。
        await db.closeAsync();
        await ensureTipitakaFile(true);
        db = await SQLite.openDatabaseAsync(TIPITAKA_DB);
        if (!(await hasPaliText(db))) {
          throw new Error("离线目录数据库损坏：重拷后仍缺 pali_text 表");
        }
      }
      return db;
    })().catch((err) => {
      tipitakaPromise = null; // 失败不缓存，下次重试
      throw err;
    });
  }
  return tipitakaPromise;
}

/** 可写的阅读缓存库（`para_html` / `download_state`）。 */
export function openReadingDb(): Promise<SQLite.SQLiteDatabase> {
  if (!readingPromise) {
    readingPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(READING_DB);
      await db.execAsync(SCHEMA);
      return db;
    })().catch((err) => {
      readingPromise = null;
      throw err;
    });
  }
  return readingPromise;
}

/** `pali_text` 的 SqlRunner，供 `unit.ts` / `commentary.ts` 使用。 */
export async function tipitakaRunner(): Promise<SqlRunner> {
  return toRunner(await openTipitakaDb());
}

/**
 * App 更新后若打包的数据库比设备上的新，则覆盖。
 *
 * 判据是 `meta.generated_at`（导出时写入，见
 * `mint/api-v13` 的 `export:mobile.heading`）。用户数据在另一个库里，
 * 覆盖不影响缓存与下载。
 */
export async function refreshTipitakaDbIfStale(bundledGeneratedAt: string): Promise<boolean> {
  const db = await openTipitakaDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'generated_at'",
  );
  if (row?.value && row.value >= bundledGeneratedAt) return false;

  await db.closeAsync();
  tipitakaPromise = null;
  new File(Paths.document, DB_DIR, TIPITAKA_DB).delete();
  await openTipitakaDb();
  return true;
}

/**
 * WAL 让下载写入与阅读读取不互相阻塞。
 * 建表用 `IF NOT EXISTS`，重复执行无副作用。
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;

-- 正文缓存：按段落存，粒度与接口返回的 items 一致。
-- html = '' 表示「服务端确认该段为空」，与「没请求过」区分 —— 服务端会跳过
-- 空段落（docs/reading-content.md §2），不记下来的话含空段的章节永远命中不了缓存。
CREATE TABLE IF NOT EXISTS para_html (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  para       INTEGER NOT NULL,
  html       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (channel, book, para)
);

-- 用户显式下载过的书，区别于阅读时被动产生的缓存（清理时不误删）。
CREATE TABLE IF NOT EXISTS download_state (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  status     TEXT    NOT NULL,
  total      INTEGER NOT NULL,
  done       INTEGER NOT NULL,
  error      TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel, book)
);
`;
