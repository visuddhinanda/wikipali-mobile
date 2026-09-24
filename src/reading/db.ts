/**
 * 阅读链路的两个数据库（见 `docs/reading-content.md` §4.1、`docs/multi-user-sync.md` §2）。
 *
 * | 文件           | 用途                 | 读写 | 来源 |
 * |----------------|----------------------|------|------|
 * | `tipitaka.db3` | 章节树 / `pali_text` | 只读 | 打包在 assets，随版本整体替换，**所有用户共享** |
 * | `reading.db3`  | 正文缓存 + 下载 + 历史/收藏/书签 + 同步队列 | 读写 | **每个用户一份**，在 `users/<uuid>/` 子目录 |
 *
 * 多用户：`reading.db3` 按当前用户作用域（`src/user/userScope.ts`）落到
 * `SQLite/users/<guest-uuid 或 user-uuid>/reading.db3`。切用户 = 切库文件。
 */
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import type { SqlRunner } from "../catalog/commentary";
import { onScopeChange, resolveScope } from "../user/userScope";

/** expo-sqlite 打开数据库时使用的目录（`Paths.document/SQLite`）。 */
const DB_DIR = "SQLite";

const TIPITAKA_DB = "tipitaka.db3";
const READING_DB = "reading.db3";

/** 把 `SQLiteDatabase` 适配成 `SqlRunner`（与 `commentary.ts` 共用的接口）。 */
export function toRunner(db: SQLite.SQLiteDatabase): SqlRunner {
  return {
    all: <T = unknown>(sql: string, params: unknown[]) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
  };
}

let tipitakaPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let readingPromise: Promise<SQLite.SQLiteDatabase> | null = null;
/** 当前 `readingPromise` 对应的用户目录 id，用于切换时判断要不要重开。 */
let readingScopeId: string | null = null;

// 切用户：关掉旧连接、清空缓存 promise，下次 open 时指向新库。
onScopeChange(() => {
  const old = readingPromise;
  readingPromise = null;
  readingScopeId = null;
  if (old) {
    old
      .then((db) => db.closeAsync())
      .catch(() => {
        /* 关闭失败忽略，连接句柄由下次 GC 释放 */
      });
  }
});

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
  // expo-file-system 57 的 `copy()` 是**异步**的（另有 `copySync()`）。
  await source.copy(target);

  const copiedSize = () => new File(dir, TIPITAKA_DB).size ?? 0;
  if (copiedSize() !== source.size) {
    const retry = new File(dir, TIPITAKA_DB);
    if (retry.exists) retry.delete();
    source.copySync(retry);
  }
  if (copiedSize() !== source.size) {
    throw new Error(
      `离线目录数据库拷贝不完整：${copiedSize()}/${source.size} 字节` +
        `（源 ${asset.localUri} → ${target.uri}，剩余空间 ${Paths.availableDiskSpace} 字节）`,
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
        await db.closeAsync();
        await ensureTipitakaFile(true);
        db = await SQLite.openDatabaseAsync(TIPITAKA_DB);
        if (!(await hasPaliText(db))) {
          throw new Error("离线目录数据库损坏：重拷后仍缺 pali_text 表");
        }
      }
      return db;
    })().catch((err) => {
      tipitakaPromise = null;
      throw err;
    });
  }
  return tipitakaPromise;
}

/**
 * 幂等补列：老版本设备上的表已存在，`CREATE TABLE IF NOT EXISTS` 不会给它补新列。
 * 用 `PRAGMA table_info` 探测后按需 `ALTER TABLE`。
 */
async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * 把 `para_html.html` 从「空段写 ''」迁移到「空段写 NULL」。
 */
async function migrateParaHtmlNullable(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string; notnull: number }>(
    "PRAGMA table_info(para_html)",
  );
  const htmlCol = cols.find((c) => c.name === "html");
  if (!htmlCol || htmlCol.notnull === 0) return;

  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      ALTER TABLE para_html RENAME TO para_html_old;
      CREATE TABLE para_html (
        channel    TEXT    NOT NULL,
        book       INTEGER NOT NULL,
        para       INTEGER NOT NULL,
        html       TEXT,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (channel, book, para)
      );
      INSERT INTO para_html (channel, book, para, html, fetched_at, expires_at)
        SELECT channel, book, para, NULLIF(html, ''), fetched_at, expires_at
        FROM para_html_old;
      DROP TABLE para_html_old;
    `);
  });
}

/** 当前用户 `reading.db3` 所在目录的 URI（不存在则创建）。 */
async function readingDirUri(scopeId: string): Promise<string> {
  const dir = new Directory(Paths.document, DB_DIR, "users", scopeId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir.uri;
}

/**
 * 首次升级：旧版本把用户数据放在共享的 `SQLite/reading.db3`，现在搬到
 * `<guest-uuid>/reading.db3`。只做一次（目标已存在则跳过）。
 */
async function migrateLegacyReadingDb(scopeId: string): Promise<void> {
  const legacy = new File(Paths.document, DB_DIR, READING_DB);
  if (!legacy.exists) return;
  const target = new File(Paths.document, DB_DIR, "users", scopeId, READING_DB);
  if (target.exists) return;
  try {
    await legacy.move(target);
  } catch {
    // 搬不动就放弃迁移：新用户从空库开始，legacy 文件不再被读取。
  }
}

/**
 * 打开指定用户（目录 id）的读写库并初始化 schema。
 * 供「当前用户」与「guest 数据合并」两类场景复用。
 */
export async function openReadingDbFor(
  scopeId: string,
): Promise<SQLite.SQLiteDatabase> {
  const dirUri = await readingDirUri(scopeId); // 先建目录，migrate 才能把 legacy 文件搬进来
  await migrateLegacyReadingDb(scopeId);
  const db = await SQLite.openDatabaseAsync(READING_DB, undefined, dirUri);
  await db.execAsync(SCHEMA);
  await ensureColumn(db, "para_html", "expires_at", "expires_at INTEGER");
  await ensureColumn(db, "download_state", "server_id", "server_id TEXT");
  await ensureColumn(db, "download_state", "cursor", "cursor TEXT");
  await migrateParaHtmlNullable(db);
  return db;
}

/** 可写的当前用户读写库（`para_html` / `download_state` / 历史 / 收藏 / 书签 / 同步队列）。 */
export function openReadingDb(): Promise<SQLite.SQLiteDatabase> {
  if (!readingPromise) {
    readingPromise = (async () => {
      const scope = await resolveScope();
      const db = await openReadingDbFor(scope.id);
      readingScopeId = scope.id;
      return db;
    })().catch((err) => {
      readingPromise = null;
      throw err;
    });
  }
  return readingPromise;
}

/**
 * 串行化 `reading.db3` 上的写事务。
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function withReadingTransaction<T>(
  task: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = await openReadingDb();
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** `pali_text` 的 SqlRunner，供 `unit.ts` / `commentary.ts` 使用。 */
export async function tipitakaRunner(): Promise<SqlRunner> {
  return toRunner(await openTipitakaDb());
}

/**
 * App 更新后若打包的数据库比设备上的新，则覆盖。
 */
export async function refreshTipitakaDbIfStale(
  bundledGeneratedAt: string,
): Promise<boolean> {
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
CREATE TABLE IF NOT EXISTS para_html (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  para       INTEGER NOT NULL,
  html       TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (channel, book, para)
);

-- 版本表：uid → 显示名。
CREATE TABLE IF NOT EXISTS channels (
  uid  TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- 用户显式下载过的书，区别于阅读时被动产生的缓存（清理时不误删）。
-- server_id：同步后回填的服务器 like.id（type=download）。
-- cursor：断点续传游标（tipitaka-reading 的 meta.next_cursor），null 表示从头 / 取完。
CREATE TABLE IF NOT EXISTS download_state (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  status     TEXT    NOT NULL,
  total      INTEGER NOT NULL,
  done       INTEGER NOT NULL,
  error      TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  cursor     TEXT,
  PRIMARY KEY (channel, book)
);

-- ── 用户行为数据（多用户同步，见 docs/multi-user-sync.md §5）──

-- 阅读记录（对应服务器 recents）。同一本书只留最后一条。
CREATE TABLE IF NOT EXISTS reading_history (
  book       INTEGER NOT NULL,
  paragraph  INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  heading    TEXT,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  PRIMARY KEY (book)
);

-- 书签（对应服务器 likes，type=bookmark）。同一（书, 段）只留一条。
CREATE TABLE IF NOT EXISTS bookmarks (
  book       INTEGER NOT NULL,
  paragraph  INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  heading    TEXT,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  PRIMARY KEY (book, paragraph)
);

-- 收藏（对应服务器 likes，type=favorite）。同一本书只收藏一次。
CREATE TABLE IF NOT EXISTS starred (
  book       INTEGER NOT NULL,
  paragraph  INTEGER,
  title      TEXT    NOT NULL,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  PRIMARY KEY (book)
);

-- 待同步操作队列：一条本地记录一行，local_key 唯一。
-- op=upsert 表示该记录存在且待推送；op=delete 表示该记录已删、待服务器删除。
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  local_key  TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  op         TEXT NOT NULL,
  payload    TEXT NOT NULL,
  server_id  TEXT,
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
`;
