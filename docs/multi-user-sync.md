# 多用户支持与数据同步设计方案

> 状态：**设计稿 v0.1（待实现）**
> 范围：登录 / 游客多用户本地隔离 + 阅读记录 / 下载记录 / 收藏 / 书签四类数据的本地持久化与服务器同步。
> 后端参照：`mint/api-v13` 的 `RecentController`（阅读记录）、`MeReactionV3Controller`（下载 / 收藏 / 书签，底层 `likes` 表）。
> 前置：`docs/README.md`（技术路线）、`docs/reading-content.md`（正文缓存与下载）、`src/auth/AuthContext.tsx`（现有登录会话）。

---

## 1. 要做什么

现在的用户行为数据（阅读记录 / 收藏 / 书签）用 AsyncStorage 存 JSON，下载状态存在共享的 `reading.db3` 里；没有登录隔离，也没有服务器同步。本设计要解决：

1. **多用户本地隔离**：每个用户（含未登录的「游客」）各自一套本地数据库，目录以 `user_id`（uuid）区分。
2. **游客也有身份**：未登录时用「设备 id 派生的确定性 uuid」当游客身份，同一设备永远同一个 uuid。
3. **登录即切换**：登录后切到该用户自己的目录；登出回到游客。
4. **行为记录都落库并同步**：阅读记录 / 下载记录 / 收藏 / 书签都在本地 SQLite 持久化，联网时与服务器同步。
5. **游客数据合并**：登录后询问是否把游客期间的记录并入该账户。

---

## 2. 目录与数据库布局

沿用 `expo-sqlite` 的 `Paths.document/SQLite` 目录（现状见 `src/reading/db.ts`）：

```
SQLite/
├── tipitaka.db3                 # 只读目录库（46MB，随版本整体替换），**所有用户共享**
└── users/
    ├── <guest-uuid>/            # 游客（设备 uuid）
    │   └── reading.db3          # 该用户的读写库：正文缓存 + 下载 + 历史/收藏/书签 + 同步队列
    └── <user-uuid>/             # 登录用户（user_uid = /auth/current 的 id）
        └── reading.db3
```

要点：

- **`tipitaka.db3` 永远共享、只读**：它只是章节树 / `pali_text` 索引，不含用户数据；更新时覆盖文件即可（现状 `refreshTipitakaDbIfStale()` 不变）。
- **每个用户一个 `reading.db3`**：正文缓存 `para_html`、版本名 `channels`、下载状态 `download_state`、以及新增的历史 / 收藏 / 书签 / 同步队列都放这里。切用户 = 切整个库文件。
- **目录名就是 uuid**：`guest` 目录名是设备 uuid（§3），登录用户目录名是 `/auth/current` 返回的 `id`（已确认 `AuthController::getUserInfoByToken` 的 `id = curr['user_uid']`，即 uuid）。
- **不迁移旧数据到新目录？迁移**：首次升级时，把旧的共享 `SQLite/reading.db3` 视为「上一个游客」的库，整体搬到 `<guest-uuid>/reading.db3`（§9）。

> 取舍说明：`para_html` 正文缓存按用户各存一份会占用更多磁盘（同一本书两个用户都下载 = 两份）。
> 这里刻意不做共享：正文缓存与下载状态强耦合（下载进度 = 已缓存段数），拆开共享会让「这个用户的下载进度」
> 依赖别的用户写入的缓存，语义变脏。磁盘换正确性，符合本 App「离线优先」的定位。

---

## 3. 设备 UUID（游客身份）

**目标**：同一台设备无论计算多少次都是同一个 uuid；不同设备不重复。

**实现**：设备 id → 确定性 uuid（UUID v5，SHA-1 + 固定 namespace）。

| 平台 | 设备 id 来源 | 说明 |
|---|---|---|
| Android | `expo-application` 的 `getAndroidId()` | `Settings.Secure.ANDROID_ID`，16 进制串；按「签名 key + 用户 + 设备」唯一，卸载重装不变 |
| iOS | `expo-application` 的 `getIosIdForVendorAsync()` | IDFV，同厂商唯一，卸载重装不变 |
| Web / 取不到 | 首次生成的随机 uuid 持久化到 SecureStore | 无设备 id 时的兜底 |

- `expo-application` 是 `expo-notifications`（直接依赖）的传递依赖，其原生模块已编进现有 dev-client，**无需重建 APK**。
- 对设备 id 做 **UUID v5**（namespace 固定为项目自留的常量），把任意长度的设备 id 折叠成标准 `8-4-4-4-12` 格式：
  - 保证「是合法 uuid」（可当目录名 / 可当本地标识，未来若要上报也合规）；
  - 同一设备 id 永远同一 uuid；不同设备 id 碰撞概率可忽略（SHA-1 128 位截断）。
- **注意**：Android `ANDROID_ID` 按签名 key 区分。本项目 debug 与 release 用不同 keystore 时，同一台手机的 debug / release 包会得到**两个不同的游客 uuid**（各自独立、各自稳定），这是平台语义，不是 bug；正式发布签名固定后即稳定。
- 不把设备 id / 游客 uuid 明文上报服务器：游客数据只在本地，登录合并时才以「并入目标账户」的方式提交（§8.4），提交的是行为记录本身，不含设备 id。

---

## 4. 用户切换与会话生命周期

```
冷启动
  ├─ 有 token → 校验 /auth/current
  │     ├─ 成功 → 当前目录 = <user.id>/          （该用户自己的库）
  │     └─ 失败 → 清会话 → 当前目录 = <guest-uuid>/
  └─ 无 token → 当前目录 = <guest-uuid>/

登录成功
  ├─ 当前目录切到 <user.id>/（不存在则建库）
  └─ 若游客库里有未合并数据 → 弹窗询问「是否把游客数据并入账户」
        ├─ 合并 → 把游客记录并进该用户库 + 入同步队列（§8.4）
        └─ 不合并 → 保留游客库原样，之后可再决定

登出
  └─ 当前目录切回 <guest-uuid>/（游客数据仍在）
```

「当前目录」由一个全局作用域模块（`src/user/userScope.ts`）持有：`{ kind: 'guest' | 'user', id: string }`。
所有 `openReadingDb()` 都从这里取目录名；切换时关闭旧连接、清空缓存 promise、指向新库。

---

## 5. 本地数据表设计（每个 `reading.db3` 内）

> 表结构的**完整权威文档**（字段语义、local_key/payload 约定、迁移策略、取舍）见
> **[`user-data-db.md`](./user-data-db.md)**；本节只列出同步相关的新表骨架。
> **服务器表格式对照**见 §7。

在现有 `reading.db3` 的 `para_html` / `channels` / `download_state` 基础上新增以下表。

### 5.1 `reading_history` —— 阅读记录（对应服务器 `recents`）

```sql
CREATE TABLE IF NOT EXISTS reading_history (
  book       INTEGER NOT NULL,      -- 书 id（pali_text.book）
  paragraph  INTEGER NOT NULL,      -- 视口顶部段
  title      TEXT    NOT NULL,      -- 书名（展示回退）
  heading    TEXT,                  -- 章节标题
  channel_id TEXT,                  -- 版本 uid（只存 uid）
  updated_at INTEGER NOT NULL,      -- epoch ms
  server_id  TEXT,                  -- 服务器 recent.id（同步后回填，删除/幂等用）
  PRIMARY KEY (book)                -- 同一本书只留最后一条（现状语义）
);
```

### 5.2 `bookmarks` —— 书签（对应服务器 `likes`，type=bookmark）

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  book       INTEGER NOT NULL,
  paragraph  INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  heading    TEXT,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  PRIMARY KEY (book, paragraph)     -- 同一（书, 段）只留一条
);
```

### 5.3 `starred` —— 收藏（对应服务器 `likes`，type=favorite）

```sql
CREATE TABLE IF NOT EXISTS starred (
  book       INTEGER NOT NULL,
  paragraph  INTEGER,               -- 收藏时所在段落
  title      TEXT    NOT NULL,
  channel_id TEXT,
  updated_at INTEGER NOT NULL,
  server_id  TEXT,
  PRIMARY KEY (book)                -- 同一本书只收藏一次
);
```

### 5.4 `download_state` —— 下载记录（对应服务器 `likes`，type=download）

沿用现有表，补一列用于同步：

```sql
ALTER TABLE download_state ADD COLUMN server_id TEXT;
```

- `download_state` 的主键是 `(channel, book)`，即「某版本下的一整本书」为一条下载记录。
- **下载的实际经文数据（`para_html`）不上传**，只同步「下载过这本书」这个记录本身。

### 5.5 `sync_outbox` —— 待同步操作队列

```sql
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  local_key  TEXT NOT NULL UNIQUE,  -- 稳定去重键：reading:<book> / bookmark:<book>-<para> / favorite:<book> / download:<channel>-<book>
  kind       TEXT NOT NULL,         -- 'reading' | 'favorite' | 'bookmark' | 'download'
  op         TEXT NOT NULL,         -- 'upsert'（存在待推送）| 'delete'（已删、待服务器删除）
  payload    TEXT NOT NULL,         -- 完整本地记录 JSON（推送 / guest 合并 / 映射 target_id 都用它）
  server_id  TEXT,                  -- 此前同步回填的服务器 like/recent id（delete 用）
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

> 为什么单独一个 outbox：**删除需要墓碑**。本地删一条收藏后，记录已不在表里，
> 若不写 `op=delete` 就无从知道还要 `DELETE /like/{id}`。outbox 一行对应一条本地记录
> （`local_key` 唯一），upsert / delete 互相覆盖，天然不会重复推送。

---

## 6. 数据映射：客户端 (book, para, channel) ↔ 服务器字段

服务器 `likes` 表唯一键是 **`(type, target_id, user_id)`**（不是 id，见迁移
`2022_05_29_103822_create_likes_table.php` 的 `$table->unique(['type','target_id','user_id'])`）。
服务器 `recents` 表唯一键是 **`(type, article_id, user_uid)`**（`RecentController::store` 的 `firstOrNew`）。

客户端只有 `book`(int) / `paragraph`(int) / `channelId`(uuid)。服务器侧能一一对应客户端
「书 + 段 + 版本」的唯一 uuid 实体是 **`progress_chapters.uid`**（迁移
`2022_05_23_070112_add_uuid_in_progress_chapters.php` 添加，`(book, para, channel_id) → uid`）。

### 6.0 锚点规则总述（核心约定）

四种行为各按什么「段」锚定到服务器实体，是本设计的核心约定，写死在这里（同时记在 `CLAUDE.md`「领域知识」）：

| 行为 | 锚定段 | 服务器 target | 精确位置 |
|---|---|---|---|
| 在读（阅读记录） | 当前页面最上面的 para（视口顶部段） | `recent`：`article_id = "<book>-<para>"` | 就是 `article_id` 里的 para |
| 收藏 favorite | 当前段**向上搜索到 level=1**（书） | `progress_chapters.uid`（level=1 段） | `context = "book:<book>-<para>"`（para=level=1 段） |
| 下载 download | 当前段**向上搜索到 level=1**（书） | `progress_chapters.uid`（level=1 段） | `context = "book:<book>-<para>:<channel>"` |
| 书签 bookmark | 当前段所属的**章节标题段**（level ≤ 7） | `progress_chapters.uid`（章节段） | `context = "para:<n>"`（n=视口顶部段） |

- **`level=1` 就是「书」**：`progress_chapters` 表是章节级翻译进度，`para` 指向 `pali_texts.paragraph`；
  当那行 `pali_texts.level=1` 时，这条 `progress_chapters.uid` 就是「书」本身、**不是「章」**，
  收藏 / 下载不需要额外的书级实体。
- **「向上搜索到 level=1」算法**（收藏/下载用）：
  `SELECT paragraph FROM pali_text WHERE book=? AND level=1 AND paragraph<=当前段 ORDER BY paragraph DESC LIMIT 1`。
  一个 book 文件可能有**多个 level=1 作品**，必须从「当前段」找它落在哪一部，**不能取第一个 level=1**。
- **书签为什么锚定章节段**：书签定位到视口顶部段（可能是 `level=100` 正文段），而 progress_chapters 只有章节级、
  无法锚定正文段，所以 target 锚定「包含它的章节标题段」（`level≤7`，`MAX(paragraph) WHERE level<=7 AND paragraph<=书签段`），
  精确段记在 `context = "para:<n>"`，下拉还原时用 context 还原精确位置。
- **下拉还原一律以反查 `target_id`（progress_chapters 表）为准**，拿到 `book/para/channel`；context 作为补充（书签用它还原精确段）。

### 6.1 阅读记录 → `recents`（RecentController）

| 服务器字段 | 客户端取值 |
|---|---|
| `type` | `"chapter"` |
| `article_id` | `"<book>-<paragraph>"`（RecentResource 的 chapter 分支就是 `explode('-', article_id)` 拆回 book/para） |
| `param` | JSON：`{ "book": book, "para": paragraph, "channel": "<channel_id>_<name>", "mode": "reading" }` |

- 唯一键 `(type, article_id, user_uid)`：同一本书同一段会覆盖（`firstOrNew` + save），符合「同一本书只留最后位置」。
- 读列表用 `GET /api/v2/recent?view=user&id=<user_uid>&type=chapter&limit=1000`，把 `article_id` 拆回 book/para、`param` 拆回 channel 即可还原本地记录。

### 6.2 收藏 / 书签 / 下载 → reactions（`MeReactionV3Controller`，底层 `likes` 表）

| 客户端类型 | `type` | `target_type` | `target_id` | `context` |
|---|---|---|---|---|
| 收藏 favorite | `"favorite"` | `"progress_chapter"` | `progress_chapters.uid`（**当前段向上搜索到的 level=1 段**，即「书」本身） | `"book:<book>-<para>"`（para=level=1 段） |
| 书签 bookmark | `"bookmark"` | `"progress_chapter"` | `progress_chapters.uid`（**包含书签所在段的章节标题段**，level ≤ 7） | `"para:<n>"`（n=视口顶部段，精确位置） |
| 下载 download | `"download"` | `"progress_chapter"` | `progress_chapters.uid`（**当前段向上搜索到的 level=1 段**，即「书」本身） | `"book:<book>-<para>:<channel>"`（para=level=1 段） |

> 各类型的锚定规则见 **§6.0 锚点规则总述**，这里只列字段映射。

`progress_chapters.uid` 的解析：

- **正向（推送时）**：`GET /api/v2/progress?view=ids&book=<book>&par=<para>&channel=<channel_id>`，返回 `rows[].id` 即 `uid`（`ProgressChapterController::index` 的 `view=ids`）。
- **反向（下拉时）**：`GET /api/v2/progress/{uid}`，返回 `book` / `para` / `channel_id`（`ProgressChapterController::show`，模型主键 `uid`）。
- 也可复用 `view=chapter_channels` 已返回的 `uid`（`ChapterChannel.uid`）。

### 6.3 书级映射（level=1 就是书）

移动端「书」（书架上的作品）= `(book, 某个 level=1 的 para)`，而 `progress_chapters`
里 `para` 指向 `level=1` 的那一行**本身就是书** —— 所以收藏 / 下载的 `target_id` 直接取
「当前所在段**向上搜索到的 level=1 段**」的 `progress_chapters.uid`，**天然就是书级实体**，不存在「章级 → 书级」的换算：

- 收藏一本书 → `type=favorite`，`target_id` = 收藏时所在段向上搜索到的 level=1 段 uid。
- 下载一本书 → `type=download`，`target_id` = 下载时所在段向上搜索到的 level=1 段 uid。
- 因为锚定的是「书」（level=1 作品）而非「当前段」，同一部作品无论在哪收藏/下载，`target_id` 恒相同，
  唯一键 `(type, target_id, user_id)` 不会发散（不会再生成第二条）。
- 「下载记录同步」=「同步『我下载过这本书』的事实」；重装后登录同步回的是 `(type=download)` 列表，
  客户端按反查的 `(book, para, channel)` 还原出 `download_state`（`status=pending, done=0`）。
- **本地下载记录分两类**：`done`（本机有正文，可离线读）与 `pending`（只有同步回来的记录、正文不在本机）。
  书架「已下载」列表**两类都显示**：`done` 记为「已下载」，`pending` 记为「待下载」，点进去即可**重新下载正文**（正文 `para_html` 不同步，本来就没了）。

---

## 7. 服务器表格式对照（实现必须参照）

### 7.1 `reactions`（`MeReactionV3Controller`，底层仍是 `likes` 表）

> 客户端同步**不再走 v2 的 `LikeController`（`/api/v2/like`）**，改用 v3 的
> `MeReactionV3Controller`（`/api/v3/me/reactions`）。两者底层同一张 `likes` 表
> （`Reaction` 模型 `$table='likes'`），唯一键都是 `(type, target_id, user_id)`。

```php
// likes 表（Reaction 模型指向它，表名不迁移）
Schema::create('likes', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->string('type', 32)->index();          // like/dislike/favorite/watch/bookmark/download
    $table->uuid('target_id')->index();
    $table->string('target_type', 32)->index();   // task/collection/progress_chapter/article/terms
    $table->string('context', 128)->nullable();
    $table->uuid('user_id')->index();
    $table->timestamps();
    $table->unique(['type', 'target_id', 'user_id']);  // ★ 唯一键不是 id
});
```

`MeReactionV3Controller` 关键行为（全线登录，user_id 一律取当前用户）：

- `POST /api/v3/me/reactions`（store）：body `{ type, target_id, target_type, context? }`，`Reaction::firstOrNew(['type','target_id','user_id'])`，**幂等**，返回 `ReactionStatusV3Resource`：`{ data: { type, count, selected:true, id } }`（id = 记录 uuid）。
- `DELETE /api/v3/me/reactions/{id}`（destroy）：只能删自己那条（否则 403），返回 `{ data: { type, count, selected:false, id:null } }`。
- `GET /api/v3/me/reactions?type=&target_type=&page=&per_page=`（index）：列出**我的全部** reactions，`ReactionV3Resource` 分页集合 `{ data: [{id,type,target_id,target_type,context,created_at,updated_at,user}], meta }` —— 这就是原 §10 缺口 1 要的「按用户拉全部 like」视图，**现已具备**。
- v3 响应是 `{ data: ... }`（单数）/ `{ data: [...], meta }`（分页），错误是 RFC 9457 Problem Details，**不再是 v2 的 `{ ok, data, message }` 信封**。

### 7.2 `recents` 表（RecentController）

```php
Schema::create('recents', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->string('type', 63)->index();
    $table->string('article_id', 255)->index();
    $table->json('param')->nullable();
    $table->uuid('user_uid')->index();
    $table->timestamps();
});
```

`RecentController` 关键行为：

- `store`：`Recent::firstOrNew(['type','article_id','user_uid'])` + `$row->param = ...` + save，**幂等**，返回 `RecentResource`。
- `index`：`view=user&id=<user_uid>`（uuid 校验）→ 该用户全部 recent，可选 `type` 过滤、`order/dir`、`offset/limit`。**这个视图齐全**，可直接用于「拉取服务器上的阅读记录」。
- `destroy/update`：空实现（**没有删除阅读记录、没有按记录 id 删除的接口**，见 §10 缺口 3）。

---

## 8. 同步引擎

### 8.1 触发时机与身份边界

- **游客只在本地 db 记录，永远不与服务器同步**：游客写操作只写本地表，**不产生 `sync_outbox`**。
- **登录用户**每次本地写操作（读记录 / 收藏 / 书签 / 下载完成）→ 写本地表 + 写 `sync_outbox`。
- `isOnline()` 为真时（`src/api/connectivity.ts`）触发 `syncNow()`；
- App 冷启动、登录成功、回到前台（AppState active）各触发一次。

### 8.2 推送（upsert / delete）

按 outbox 顺序逐条处理，只对**登录用户**推送（游客无服务器身份，见 §8.4）：

| kind | op | API |
|---|---|---|
| reading | upsert | `POST /api/v2/recent` `{ type, article_id, param }` → 回填 `reading_history.server_id` |
| favorite/bookmark/download | upsert | `POST /api/v3/me/reactions` `{ type, target_id, target_type, context }` → 回填对应表 `server_id` |
| favorite/bookmark/download | delete | `DELETE /api/v3/me/reactions/{server_id}`（若本地无 `server_id`，说明从未成功同步过，直接丢弃该墓碑） |
| reading | delete | 服务端无删除接口，本地删除即可（§10 缺口 3） |

成功 → 清掉 outbox 该条（upsert 成功时把服务器 id 回填到本地表 `server_id`）；失败（离线 / 401 / 网络错）→ 保留、`attempts++`、记 `last_error`，下次再试。**重试满 3 次仍失败即放弃**（数据问题如 channel 无效、target 不存在，再试也没用；本地记录保留、不再占用队列）。

### 8.3 拉取（首次同步 / 换设备）

登录后首次打开某用户库时，若该库是新建的（本地没有「已做过一次全量拉取」标记），先拉服务器，再推本地：

1. `GET /api/v2/recent?view=user&id=<uid>&type=chapter&limit=1000` → 灌入 `reading_history`（拆 `article_id` / `param`，回填 `server_id`，冲突按「较新者胜」）。
2. `GET /api/v3/me/reactions?type=<type>&target_type=progress_chapter&page=&per_page=` → 拉回我的收藏 / 书签 / 下载，逐条 `GET /api/v2/progress/{target_id}` **反查**还原成 `(book, para, channel)` 后写入本地（收藏/书签较新者胜；下载只补本地没有的、优先用 context 还原 book+channel）。
3. 推本地 outbox。

> 现状：**阅读记录、收藏、书签、下载均已实现下拉**（收藏/书签靠反查还原，下载优先用 context）。

### 8.4 游客数据合并（登录后询问）

登录成功后，检查 `<guest-uuid>/reading.db3` 是否有未合并数据；若有，弹窗询问：

- **合并**：把游客库的 `reading_history / bookmarks / starred` 逐条复制进登录用户库（冲突按 `updated_at` 较新者胜），每条写进该用户的 `sync_outbox`（`op=upsert`）；下载记录只入队 upsert（不复制正文），随后 `syncNow()` 上行。完成后用 AsyncStorage 标记该账户「已合并」。
- **不合并**：保留游客库，不复制。
- 合并冲突规则：**以时间较新者为准**（`updated_at` 更大者胜）；相同 `(book)` / `(book, paragraph)` 的记录合并为一条。

---

## 9. 旧数据迁移

现状：`SQLite/reading.db3`（含 `para_html` / `channels` / `download_state`）与 AsyncStorage 里的
`@wikipali/reading-history` / `@wikipali/bookmarks` / `@wikipali/starred-books`。

升级到多用户版本时：

1. 首次取得游客 uuid 后，把 `SQLite/reading.db3` **移动**到 `SQLite/users/<guest-uuid>/reading.db3`（这就是旧游客的库）。
2. 把 AsyncStorage 里的三条 JSON 灌进该库的三张新表（不直接入队，登录合并时再入队），然后删除旧 AsyncStorage key。
3. `tipitaka.db3` 原地不动。

迁移只做一次，用 `meta` 表或一个 AsyncStorage flag 标记完成。

---

## 10. API 缺口清单（需要服务端调整，客户端暂不动服务端）

按严重程度排序。**这些是客户端实现需要、但 `mint/api-v13` 当前仍缺失或语义不符的点，需服务端同学补齐。**

1. **【中】`recent` 缺删除接口**
   - 现状：`RecentController::destroy` / `update` 都是空实现；`apiResource` 虽注册了 `DELETE /recent/{recent}`，但方法体为空。
   - 影响：客户端「清空阅读记录」只能本地清，服务器残留；换设备又会拉回来。
   - 建议：实现 `destroy`（按 `recent.id` 删除，校验 `user_uid === 当前用户`）。

2. **【低】`recent` 的 `type` 语义与阅读记录对齐**
   - 现状：`RecentResource` 支持 `article` / `chapter` / `term` 三类，`chapter` 分支解析 `article_id = "<book>-<paragraph>"`、`param.channel`。本设计沿用 `type=chapter`，**无需改动**；列出只为确认契约。

**已解决（不再需要客户端 workaround）：**

- ~~收藏 / 下载是「书级」、服务器只有「章级」实体~~ → **`progress_chapters` 里 `para` 指向 `pali_texts.level=1` 的行就是「书」**（§6.3），收藏 / 下载锚定 level=1 的 uid 即是书级实体。
- ~~按用户拉全部 like~~ → `GET /api/v3/me/reactions` 已提供。
- ~~下拉需要 `target_id → (book, para, channel)` 反查~~ → **`GET /api/v2/progress/{uid}` 反查已提供**（`ProgressChapterController::show`，模型主键 `uid`），客户端 `pullReactions` 已实现下拉还原（§8.3）。
- ~~`firstOrNew` 查询条件与唯一索引不一致~~ → `MeReactionV3Controller::store` 用 `['type','target_id','user_id']`。
- ~~列表响应缺 `user_id`~~ → 不再适用：`/me/reactions` 是自己视角，`ReactionV3Resource` 带 `user` 对象。

> 客户端当前行为：阅读记录、收藏、书签、下载均已双向同步；「清空阅读记录」只清本地（缺口 1 补齐后可删服务器）。
> 缺口补齐后，客户端只需在 `src/api/like.ts` / `src/api/recent.ts` 增加对应调用，不改本地表结构。

---

## 11. 安全与隐私

- **游客只在本地 db 记录，永远不与服务器同步**：游客不产生 `sync_outbox`、不发起任何服务器读写；其 uuid 与设备 id 只用于本地目录名，不上报。
- 只有登录用户才会产生同步队列并上行，同步请求复用现有 `authHeaders()`（Bearer token）。
- token 仍走 `expo-secure-store`（现状不变）。
- 正文缓存（`para_html`）与书名快照均为本地数据，不上传。

---

## 12. 测试说明（检查表）

> 触发方式见仓库根 `CLAUDE.md`「书架测试 skill」：说「测试书架功能」自动跑一遍并输出报告；
> 只说「测试」不改 bug，说「测试并改代码」才测 + 改。脚本 `scripts/test-bookshelf.sh`。
>
> 测试环境：真机 `com.iapt.mobile`，宿主机 `adb -a -P 5037`，本地服务器 `127.0.0.1:8000`
> （对外 `0.0.0.0:8000`），测试账号 `visuddhinanda` / `123456`。
> 验证手段三件套：**本地 db**（`adb exec-out run-as com.iapt.mobile cat .../reading.db3` + sqlite3）、
> **服务器**（curl `/api/v3/me/reactions`、`/api/v2/recent`）、**手机 UI**（`uiautomator dump`）。

### 12.1 不登录（guest）

| # | 操作 | 预期 |
|---|---|---|
| G1 | 进入任意书阅读 | guest 库 `reading_history` 新增一条（book+视口顶部段），书架「在读」显示 |
| G2 | 收藏一本书 | guest 库 `starred` 新增，书架「收藏」显示 |
| G3 | 取消收藏 | guest 库 `starred` 删除，书架「收藏」消失 |
| G4 | 加书签 | guest 库 `bookmarks` 新增（book+精确段），书架「书签」显示 |
| G5 | 删书签 | guest 库 `bookmarks` 删除，书架「书签」消失 |
| G6 | 下载一本书 | guest 库 `download_state` 新增 `done`，书架「已下载」显示 |
| G7 | 删除下载（仅删数据） | `para_html` 清空、`download_state` 变 `pending`，记录保留 |
| G8 | 删除下载（数据和记录） | `para_html` 清空、`download_state` 删除 |
| G9 | 四个 tab 列表 | 书架「在读/已下载/收藏/书签」显示与 db 一致 |
| G10 | **guest 不同步** | guest 库 `sync_outbox` 恒为 0；服务器 `recents`/`reactions` **无新增** |

### 12.2 登录账号

| # | 操作 | 预期 |
|---|---|---|
| L1 | 登录 | 目录切到 `<user-uuid>/`；若 guest 有数据弹「同步游客数据？」 |
| L2 | 合并（选「同步」） | guest 的阅读/收藏/书签/下载**复制进** user 库，并 push 到服务器 |
| L3 | 合并（选「暂不」） | 不复制，user 库无 guest 新增数据 |
| L4 | 账号下阅读/收藏/书签/下载 | user 库各表正确增删，`sync_outbox` 入队 |
| L5 | **有网** 时操作 | 操作后（前台/登录收尾触发 `syncNow`）服务器立即出现对应 `recents`/`reactions`，outbox 清空 |
| L6 | **无网** 时操作（开飞行模式） | 本地 db 照常更新，`sync_outbox` 累积（`attempts` 增长），服务器**无新增** |
| L7 | 无网操作后**恢复网络** | outbox 自动补推，服务器出现之前累积的操作，outbox 清空 |
| L8 | 网络 db 改变（外部往服务器加一条）→ 打开 app | 冷启动/登录下拉，本地出现该条（收藏/书签/下载靠反查还原，阅读靠 recent） |
| L9 | 网络 db 改变 → 进行上述操作 | 操作触发 `syncNow`，本地与服务器双向收敛 |

### 12.3 退出账号

| # | 操作 | 预期 |
|---|---|---|
| E1 | 登出 | 目录切回 `<guest-uuid>/`，书架显示 guest 的数据（不是账号数据） |
| E2 | 登出后操作 | 回到 12.1 的 guest 行为（本地记录、不同步） |

### 12.4 已知边界（预期内，不算 bug）

- 旧数据 channel 无效（如 `7fea264d...`）：对应收藏/书签 push 满 3 次后放弃，本地保留。
- `recent` 无删除接口：清阅读记录只清本地，服务器残留。
- 书签下拉还原到「章节段」（progress_chapters 只有章节级），精确段靠 context 还原。
