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
 *
 * ## 并发模型（为什么这么写）
 *
 * expo-sqlite（Android）有两个会表现为
 * `Call to function 'NativeDatabase.xxxAsync' has been rejected → NullPointerException`
 * 的坑，这里的设计就是围着它们转的：
 *
 * 1. **同一文件只能有一个 JS 句柄。** 同一路径再 `openDatabaseAsync`，原生层复用同一个
 *    `NativeDatabase`，但 JS 侧多出一个 SharedObject；任何一个句柄被 `closeAsync` 或被 GC，
 *    `sharedObjectDidRelease()` 就把原生连接关掉，另一个句柄随即失效。
 *    → 每个文件只开一次、进程内常驻、永不关闭（`registry.handles`，挂在 globalThis 上，
 *    Fast Refresh 重跑本模块也不会重开）。
 * 2. **原生调用不能并发。** expo-modules-core 的 `SharedObjectRegistry.pairs` 读时不加锁，
 *    并发调用（每条语句都会新建/释放 NativeStatement）会读到被释放的对象（expo/expo #50855）。
 *    → 所有原生调用经过一道全局闸门 `viaGate`，**一次只放行一条原生调用**；闸门只包住
 *    原生调用本身、从不包住业务代码，所以不需要「可重入」，也不会自锁。
 *
 * 在此之上，每个 `reading.db3` 连接再有一把**连接锁**（`withReadingWrite` /
 * `withReadingTransaction` 持有）：保证一个逻辑操作（尤其是事务）执行期间，别的调用的语句
 * 不会插进这个连接、混进它的事务。tipitaka 只读、没有事务，只走闸门不加锁。
 *
 * 约束：**连接锁不可重入** —— 在 `withReading*` 的回调里只能用传进来的 `db`，不要再调用
 * 同一用户库的 `withReading*`（会自锁）；读 tipitaka（`tipitakaRunner`）随便调。
 */
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import type { SqlRunner } from "../catalog/commentary";
import { resolveScope } from "../user/userScope";

/** expo-sqlite 打开数据库时使用的目录（`Paths.document/SQLite`）。 */
const DB_DIR = "SQLite";

const TIPITAKA_DB = "tipitaka.db3";
const READING_DB = "reading.db3";

/**
 * 受控的数据库句柄：只暴露经过闸门的几个方法，原始 `SQLiteDatabase` 不出本模块
 * （拿不到就没法 close、没法绕过闸门）。
 */
export interface SqlDb {
  getAllAsync<T>(source: string, params?: SQLite.SQLiteBindParams): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: SQLite.SQLiteBindParams): Promise<T | null>;
  runAsync(source: string, params?: SQLite.SQLiteBindParams): Promise<SQLite.SQLiteRunResult>;
  execAsync(source: string): Promise<void>;
}

/** 一把最简单的 FIFO 异步锁。 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

interface Registry {
  /** 全局闸门：所有原生调用排成一队。 */
  gate: Mutex;
  /** `tipitaka` / `reading:<scopeId>` → 唯一句柄（初始化完成后才 resolve）。 */
  handles: Map<string, Promise<SqlDb>>;
  /** `reading:<scopeId>` → 连接锁。 */
  locks: Map<string, Mutex>;
}

// 挂在 globalThis：开发时 Fast Refresh 会重跑本模块，若重建 registry 就会对同一文件
// 再开一个句柄（见上文坑 1）。
const g = globalThis as typeof globalThis & { __wikipaliSqlite?: Registry };
const registry: Registry = (g.__wikipaliSqlite ??= {
  gate: new Mutex(),
  handles: new Map(),
  locks: new Map(),
});

/** 一次只放行一条原生调用。`call` 里只能有原生调用，不能有业务代码。 */
function viaGate<T>(call: () => Promise<T>): Promise<T> {
  return registry.gate.run(call);
}

function gated(db: SQLite.SQLiteDatabase): SqlDb {
  return {
    getAllAsync: <T>(source: string, params: SQLite.SQLiteBindParams = []) =>
      viaGate(() => db.getAllAsync<T>(source, params)),
    getFirstAsync: <T>(source: string, params: SQLite.SQLiteBindParams = []) =>
      viaGate(() => db.getFirstAsync<T>(source, params)),
    runAsync: (source: string, params: SQLite.SQLiteBindParams = []) =>
      viaGate(() => db.runAsync(source, params)),
    execAsync: (source: string) => viaGate(() => db.execAsync(source)),
  };
}

/** 按 key 取唯一句柄；首次调用时打开并初始化，失败则下次重试。 */
function sharedHandle(key: string, open: () => Promise<SqlDb>): Promise<SqlDb> {
  let handle = registry.handles.get(key);
  if (!handle) {
    handle = open().catch((err) => {
      registry.handles.delete(key);
      throw err;
    });
    registry.handles.set(key, handle);
  }
  return handle;
}

function lockOf(key: string): Mutex {
  let lock = registry.locks.get(key);
  if (!lock) {
    lock = new Mutex();
    registry.locks.set(key, lock);
  }
  return lock;
}

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

/** 打开的库里到底有没有正文表 —— 空文件也能被 SQLite 正常打开。 */
async function hasPaliText(db: SqlDb): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name = 'pali_text'",
  );
  return (row?.n ?? 0) > 0;
}

/** 只读的三藏目录库（`pali_text`）。 */
function tipitakaDb(): Promise<SqlDb> {
  return sharedHandle("tipitaka", async () => {
    await ensureTipitakaFile();
    let raw = await viaGate(() => SQLite.openDatabaseAsync(TIPITAKA_DB));
    if (!(await hasPaliText(gated(raw)))) {
      // 句柄尚未交出去，这里关掉是安全的。
      const broken = raw;
      await viaGate(() => broken.closeAsync());
      await ensureTipitakaFile(true);
      raw = await viaGate(() => SQLite.openDatabaseAsync(TIPITAKA_DB));
      if (!(await hasPaliText(gated(raw)))) {
        throw new Error("离线目录数据库损坏：重拷后仍缺 pali_text 表");
      }
    }
    return gated(raw);
  });
}

/** `pali_text` 的 SqlRunner，供 `unit.ts` / `commentary.ts` 使用（每条查询各自过闸门）。 */
const tipitakaSql: SqlRunner = {
  all: async <T = unknown>(sql: string, params: unknown[]) =>
    (await tipitakaDb()).getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
};

export async function tipitakaRunner(): Promise<SqlRunner> {
  return tipitakaSql;
}

/**
 * 幂等补列：老版本设备上的表已存在，`CREATE TABLE IF NOT EXISTS` 不会给它补新列。
 * 用 `PRAGMA table_info` 探测后按需 `ALTER TABLE`。
 */
async function ensureColumn(
  db: SqlDb,
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
async function migrateParaHtmlNullable(db: SqlDb): Promise<void> {
  const cols = await db.getAllAsync<{ name: string; notnull: number }>(
    "PRAGMA table_info(para_html)",
  );
  const htmlCol = cols.find((c) => c.name === "html");
  if (!htmlCol || htmlCol.notnull === 0) return;

  // 不包事务：多语句 execAsync 若中途失败，事务会一直开着把连接卡住。
  // 迁移只跑一次，多语句 execAsync 即使中断，下次启动会因表已重命名而自愈。
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
}

/** 指定用户目录的读写库（唯一句柄，首次打开时建表/补列/迁移）。 */
function readingDbFor(scopeId: string): Promise<SqlDb> {
  return sharedHandle(`reading:${scopeId}`, async () => {
    const dirUri = await readingDirUri(scopeId); // 先建目录，migrate 才能把 legacy 文件搬进来
    await migrateLegacyReadingDb(scopeId);
    const raw = await viaGate(() =>
      SQLite.openDatabaseAsync(READING_DB, undefined, dirUri),
    );
    const db = gated(raw);
    await db.execAsync(SCHEMA);
    await ensureColumn(db, "para_html", "expires_at", "expires_at INTEGER");
    await ensureColumn(db, "download_state", "server_id", "server_id TEXT");
    await ensureColumn(db, "download_state", "cursor", "cursor TEXT");
    await migrateParaHtmlNullable(db);
    return db;
  });
}

/**
 * 在指定用户库上执行一个逻辑操作（持有该连接的锁）。
 * 一般用 `withReadingWrite`（当前用户）；登录合并、旧数据迁移这类要碰「非当前用户库」的才用这个。
 */
export async function withReadingWriteFor<T>(
  scopeId: string,
  task: (db: SqlDb) => Promise<T>,
): Promise<T> {
  const db = await readingDbFor(scopeId);
  return lockOf(`reading:${scopeId}`).run(() => task(db));
}

/** 同 `withReadingWriteFor`，并把 `task` 包在一个事务里（抛错即回滚）。 */
export async function withReadingTransactionFor<T>(
  scopeId: string,
  task: (db: SqlDb) => Promise<T>,
): Promise<T> {
  const db = await readingDbFor(scopeId);
  return lockOf(`reading:${scopeId}`).run(async () => {
    await db.execAsync("BEGIN");
    try {
      const result = await task(db);
      await db.execAsync("COMMIT");
      return result;
    } catch (err) {
      await db.execAsync("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
}

/** 当前用户库上的一次读写（持有连接锁，与事务互斥）。 */
export async function withReadingWrite<T>(
  task: (db: SqlDb) => Promise<T>,
): Promise<T> {
  const scope = await resolveScope();
  return withReadingWriteFor(scope.id, task);
}

/** 当前用户库上的一个事务（本地写 + 入队同步要原子时用）。 */
export async function withReadingTransaction<T>(
  task: (db: SqlDb) => Promise<T>,
): Promise<T> {
  const scope = await resolveScope();
  return withReadingTransactionFor(scope.id, task);
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
