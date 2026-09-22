# 用户数据数据库设计（SQLite）

> 状态：**v1.0（与实现一致）**
> 代码：`src/reading/db.ts`（schema / 打开 / 迁移）、`src/data/queue.ts`（同步队列写入）、`src/data/*`（读写与入队）。
> 前置：`docs/README.md`（技术路线）、`docs/multi-user-sync.md`（多用户隔离与同步总设计）。
> 范围：本文只描述**用户数据**落在哪、有哪些表、字段含义与约束；同步协议与服务器字段映射见 `docs/multi-user-sync.md` §6–§8。

---

## 1. 定位

App 的本地持久化分两类：

| 类别 | 文件 | 读写 | 归属 |
|---|---|---|---|
| 只读目录库 | `tipitaka.db3` | 只读 | **所有用户共享**，打包在 `assets/db/`，随版本整体替换 |
| 用户数据库 | `reading.db3` | 读写 | **每个用户一份**，按 `user_id` 分目录 |

本文描述第二个：`reading.db3` 的内部结构。它同时装着两块东西，要区分清楚：

1. **内容缓存**（非用户行为）：`para_html`（正文段落 HTML）、`channels`（版本显示名）。它们本质上与「谁在读」无关，但为保持「下载进度 = 已缓存段数」的语义干净，随用户一起分库（取舍见 §8）。
2. **用户行为数据**（本次重点）：`download_state`（下载记录）、`reading_history`（阅读记录）、`bookmarks`（书签）、`starred`（收藏）、`sync_outbox`（待同步队列）。这些是真正的用户数据，按 `user_id` 隔离并同步。

---

## 2. 文件与目录布局

沿用 `expo-sqlite` 的默认目录 `Paths.document/SQLite`：

```
SQLite/
├── tipitaka.db3                 # 只读目录库（46MB，共享，随版本替换）
└── users/
    ├── <guest-uuid>/            # 游客（设备 uuid，见 multi-user-sync.md §3）
    │   └── reading.db3
    └── <user-uuid>/             # 登录用户（user_uid = /auth/current 的 id）
        └── reading.db3
```

- 目录名 = `user_id`（uuid）。游客是设备派生 uuid，登录用户是服务器 `user_uid`。
- 切换用户 = 关闭旧连接、重开新 `reading.db3`（`src/user/userScope.ts` 的 `onScopeChange` 驱动 `db.ts` 重开）。
- 旧版本把用户数据放在共享的 `SQLite/reading.db3`，升级时**整体搬到** `<guest-uuid>/reading.db3`（一次性，见 §7）。

---

## 3. 表总览

| 表 | 主键 | 类别 | 对应服务器 | 同步方式 |
|---|---|---|---|---|
| `para_html` | (channel, book, para) | 内容缓存 | — | 不上传 |
| `channels` | uid | 内容缓存 | — | 不上传 |
| `download_state` | (channel, book) | 用户行为 | `likes`（type=download） | upsert |
| `reading_history` | book | 用户行为 | `recents` | upsert（无删除接口） |
| `bookmarks` | (book, paragraph) | 用户行为 | `likes`（type=bookmark） | upsert / delete |
| `starred` | book | 用户行为 | `likes`（type=favorite） | upsert / delete |
| `sync_outbox` | id（local_key 唯一） | 同步队列 | — | 仅登录用户产生，驱动上面三类的推送 |

所有表都建在同一个 `reading.db3` 里，`PRAGMA journal_mode = WAL`（下载写入与阅读读取不互相阻塞）。

> **身份边界**：`sync_outbox` 只在**登录用户**库里产生；**游客只在本地记录、永远不与服务器同步**，
> 因此游客库不写 `sync_outbox`（`src/data/queue.ts` 对游客身份 no-op）。

---

## 4. 表结构详细设计

### 4.1 `para_html` —— 正文段落缓存（非用户行为）

```sql
CREATE TABLE IF NOT EXISTS para_html (
  channel    TEXT    NOT NULL,   -- 版本 uid（channels.uid）
  book       INTEGER NOT NULL,   -- 书 id（pali_text.book）
  para       INTEGER NOT NULL,   -- 段落号
  html       TEXT,               -- 段落 HTML；NULL = 服务端本次没返回该段
  fetched_at INTEGER NOT NULL,   -- 抓取时间（epoch ms）
  expires_at INTEGER,            -- 空段占位的过期时间；非空正文为 NULL（永不过期）
  PRIMARY KEY (channel, book, para)
);
```

- 按**段落**存，不按阅读区间存（区间互相重叠，段落是唯一稳定复用单位）。
- `html IS NULL` 表示「该版本这段没译文」，与「没请求过」区分；空段记过期时间，过期后若联网重试。
- 这是「下载的实际经文数据」，**只存本地、不上传**（见 `multi-user-sync.md` §1）。

### 4.2 `channels` —— 版本显示名缓存（非用户行为）

```sql
CREATE TABLE IF NOT EXISTS channels (
  uid  TEXT PRIMARY KEY,         -- 版本 uid
  name TEXT NOT NULL             -- 显示名（可能滞后于服务端改名）
);
```

- 记录里只存 uid，显示名查这里；离线也能挑版本、显示名字。

### 4.3 `download_state` —— 下载记录（用户行为）

```sql
CREATE TABLE IF NOT EXISTS download_state (
  channel    TEXT    NOT NULL,   -- 版本 uid
  book       INTEGER NOT NULL,   -- 书 id
  status     TEXT    NOT NULL,   -- pending | downloading | paused | done | error
  total      INTEGER NOT NULL,   -- 分母：该版本本书有译文的段数
  done       INTEGER NOT NULL,   -- 分子：已缓存到有正文的段数
  error      TEXT,               -- 最近一次错误信息
  updated_at INTEGER NOT NULL,   -- epoch ms
  server_id  TEXT,               -- 同步后回填的服务器 like.id（type=download）
  PRIMARY KEY (channel, book)
);
```

- 主键 `(channel, book)` = 「某版本下的一整本书」为一条下载记录。
- `status=done` 时入队一条下载同步（`type=download`），**只同步记录、不同步正文**。
- 进度更新用 `INSERT ... ON CONFLICT(channel,book) DO UPDATE`，**不覆盖 `server_id`**。

### 4.4 `reading_history` —— 阅读记录（用户行为）

```sql
CREATE TABLE IF NOT EXISTS reading_history (
  book       INTEGER NOT NULL,   -- 书 id
  paragraph  INTEGER NOT NULL,   -- 视口顶部段（恢复阅读位置更精确）
  title      TEXT    NOT NULL,   -- 书名（展示回退）
  heading    TEXT,               -- 当前章节标题
  channel_id TEXT,               -- 版本 uid（只存 uid）
  updated_at INTEGER NOT NULL,   -- epoch ms
  server_id  TEXT,               -- 同步后回填的服务器 recent.id
  PRIMARY KEY (book)             -- 同一本书只留最后一条
);
```

- 主键 `book`：同一本书只保留最后一次位置；写入时 `INSERT OR REPLACE` + 裁剪最旧的 `MAX_RECORDS=100`。
- 对应服务器 `recents`：`type=chapter`、`article_id="<book>-<paragraph>"`、`param` 存 channel 等。

### 4.5 `bookmarks` —— 书签（用户行为）

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  book       INTEGER NOT NULL,
  paragraph  INTEGER NOT NULL,   -- 书签所在段落
  title      TEXT    NOT NULL,
  heading    TEXT,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,               -- 同步后回填的服务器 like.id
  PRIMARY KEY (book, paragraph)  -- 同一（书, 段）只留一条
);
```

- 以「书 + 段」为粒度；删除时写 `sync_outbox` 的 `op=delete` 墓碑（服务器有 `DELETE /like/{id}`）。
- 上限 `MAX_RECORDS=500`。

### 4.6 `starred` —— 收藏（用户行为）

```sql
CREATE TABLE IF NOT EXISTS starred (
  book       INTEGER NOT NULL,
  paragraph  INTEGER,            -- 收藏时所在段落（可空；也用于映射服务器 target）
  title      TEXT    NOT NULL,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  PRIMARY KEY (book)             -- 同一本书只收藏一次
);
```

- 主键 `book`：同一本书只收藏一次；删除走 `op=delete` 墓碑。
- 上限 `MAX_RECORDS=200`。

### 4.7 `sync_outbox` —— 待同步操作队列

```sql
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  local_key  TEXT NOT NULL UNIQUE,-- 稳定去重键（见 §5）
  kind       TEXT NOT NULL,       -- reading | favorite | bookmark | download
  op         TEXT NOT NULL,       -- upsert（存在待推送）| delete（已删、待服务器删除）
  payload    TEXT NOT NULL,       -- 完整本地记录 JSON（推送/guest 合并/映射 target 都用它）
  server_id  TEXT,                -- 此前同步回填的服务器 like/recent id（delete 用）
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

- **仅登录用户产生**：游客只在本地记录、永远不与服务器同步，`src/data/queue.ts` 对游客身份 no-op，游客库不写这张表。
- **一行 = 一条本地记录**（`local_key` 唯一），upsert / delete 互相覆盖，天然不重复推送。
- 删除需要墓碑：本地删掉后记录已不在表里，靠 `op=delete` 记住还要 `DELETE /like/{id}`。
- 失败保留、`attempts++` 记 `last_error`，下次再试；单条失败不阻塞其余。

---

## 5. `local_key` 与 `payload` 约定

`local_key` 是 outbox 的稳定去重键（`src/data/queue.ts`）：

| kind | local_key |
|---|---|
| reading | `reading:<book>` |
| favorite | `favorite:<book>` |
| bookmark | `bookmark:<book>-<paragraph>` |
| download | `download:<channel>-<book>` |

`payload` 是完整本地记录的 JSON，供离线重放、guest 合并、以及推送时映射服务器字段使用：

| kind | payload 关键字段 |
|---|---|
| reading | `{ book, paragraph, title, heading, channelId, updatedAt }`（`paragraph` = 视口顶部段） |
| favorite | `{ book, paragraph, title, channelId, updatedAt }`（`paragraph` = 收藏时所在段，用于向上搜 level=1） |
| bookmark | `{ book, paragraph, title, heading, channelId, updatedAt }`（`paragraph` = 视口顶部段，记 context） |
| download | `{ channel, book, paragraph, updatedAt }`（`paragraph` = 下载时所在段，用于向上搜 level=1） |

> 推送时 `target_id`（progress_chapters.uid）不是预先算好的，而是由 `payload` 现调
> `progress?view=ids` 解析（`src/data/sync.ts`），这样离线写入也能工作。
> **锚点规则**（见 CLAUDE.md「领域知识」）：favorite / download 锚定「当前段向上搜索到的 level=1 段」；
> bookmark 锚定「包含它的章节标题段」，精确段记 context `para:<n>`。

---

## 6. `server_id` 字段的用途

四张用户行为表都带 `server_id`（可空）：

1. **删除定位**：删除一条已同步记录时，需要它才知道 `DELETE /like/{id}` 的目标 id。
2. **幂等去重**：再次 upsert 同一条时，服务器 `firstOrNew` 返回同一个 id，本地覆盖回填。
3. **回填时机**：推送成功后才写回；从未同步成功的记录 `server_id = NULL`（此时 delete 墓碑会被直接丢弃，无需发服务器删除）。

---

## 7. 迁移策略

所有迁移都在 `openReadingDbFor()` 里做，幂等可重复：

1. **建目录**：`SQLite/users/<uuid>/` 不存在则 `create({ intermediates: true })`。
2. **旧文件搬迁**（一次性）：若共享的 `SQLite/reading.db3` 还在、且目标 `<uuid>/reading.db3` 不存在，`move` 过去（旧库 = 上一个游客的库）。
3. **补列**（`ensureColumn`）：`PRAGMA table_info` 探测后按需 `ALTER TABLE` —— 现在补 `para_html.expires_at`、`download_state.server_id`。
4. **旧 AsyncStorage 搬迁**（一次性，`src/data/migrate.ts`）：把 `@wikipali/reading-history` / `@wikipali/bookmarks` / `@wikipali/starred-books` 三条 JSON 灌进游客库对应表，随后删除旧 key。
5. **`migrateParaHtmlNullable`**：老库 `para_html.html` 是 NOT NULL 且空段写空串，重建表改成可空、空串转 NULL。

---

## 8. 取舍与约束

- **`para_html` 按用户分存**：正文缓存本可共享，但「下载进度 = 已缓存段数」强耦合，拆开共享会让下载进度依赖别的用户写入的缓存，语义变脏；磁盘换正确性（离线优先定位）。
- **写事务串行化**：`withReadingTransaction()` 用 promise 链把写事务排成队列（`withTransactionAsync` 是裸 BEGIN/COMMIT，同连接并发会嵌套失败）。
- **连接生命周期**：切用户时 `onScopeChange` 关闭旧连接、清空缓存 promise；`openReadingDbFor(scopeId)` 用于 guest 合并等需要「打开指定用户库」的场景（独立连接，用完关闭）。
- **主键即业务唯一键**：四张用户行为表的主键直接表达业务去重规则（阅读/收藏按书、书签按书+段、下载按版本+书），与服务器唯一键 `(type, target_id, user_id)` / `(type, article_id, user_uid)` 一一对应。
