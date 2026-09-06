# 阅读内容获取、阅读单元切分与离线缓存

本文定义阅读器「拿到正文」这条链路的完整设计：**用哪个接口取数**、
**一次取多少（阅读单元切分算法）**、**取回来存在哪（缓存与离线下载）**。

替换掉的旧路径见 §1.2，新链路总览：

```
用户点书名
  └─ 本地 SQLite（pali_text）算出阅读单元区间 [from, to]      ← §3
      └─ 查缓存库（para_html），列出缺口段落                  ← §4
          └─ 缺口走 tipitaka-read-para 接口批量拉取           ← §2
              └─ 写回缓存库（事务），拼成 HTML 灌进 WebView
```


## 1. 背景

### 1.1 要解决的问题

一本书的正文体量在 40 万–155 万字符之间（全库 9478 万字符 / 42.7 万段），
**无法一次加载**。必须切成「阅读单元」按需取。

切分不能简单地「取最末层章节」，因为：

- 父章节标题与第一个子章节标题之间**还有正文**（序分、缘起等），
  只取子章节会把这段正文漏掉；
- 一直下沉到最末层，常常只剩几十个字符，**单屏内容太少，阅读体验差**。

§3 的算法就是为这两点设计的。

### 1.2 被替换的旧路径

| 旧实现 | 位置 | 处置 |
|---|---|---|
| `chapter-content/{book}-{para}?mode=read` | `src/api/catalog.ts` `fetchChapterContent` | **删除**。其 `content` 是结构化 JSON 字符串，需要 best-effort 递归拼装，结构从未与线上核对过 |
| `search/tipitaka_chapter_{book}-{para}_{channel}` | `src/api/catalog.ts` `fetchChapterByChannel` | **删除**。一次只能取「一个章节」，粒度与新算法的浮动区间对不上 |
| `flattenReadHtml()` | 同上 | 随 `fetchChapterContent` 一并删除 |
| `getChapterContent` / `getChapterByChannel` | `src/api/index.ts` | 由 `getReadingUnit()` 取代 |
| 章节树读 `src/data/tipitaka_heading.json` | `src/catalog/headings.ts` | 改读 SQLite `pali_text`（JSON 只有标题行，缺 `level=100` 正文行，算不出区间字符数） |


## 2. 数据接口：`tipitaka-read-para`

后端实现：`mint/api-v13/app/Http/Controllers/TipitakaReadParaController.php`

```
GET /api/v3/tipitaka-read-para
    ?book=93&para=5&to=10
    &channel=73c03e1a-f333-11f0-808a-438f0af4b9e9
    &format=html&view=display
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `book` | ✅ | 书 id |
| `para` | ✅ | 区间起始段 |
| `to` | | 区间结束段（含）。缺省 = `para`，即单段 |
| `channel` | ✅ | 频道 uuid（原文 / 各译本）|
| `format` | | `html` \| `markdown` \| `react` \| `text`，缺省 `html` |
| `view` | | `display`（整段合并）\| `sentences`（逐句）\| `all`，缺省 `display` |

响应（实测，已省略部分内容）：

```json
{
  "ok": true,
  "data": {
    "items": [
      { "para": 5, "display": "<div class='translation' data-para='5'><h4><div class='sentence' data-sid='93-5-2-2'><span>游行者品</span></div></h4></div>" },
      { "para": 6, "display": "<div class='translation' data-para='6'><div class='para-block'><div class='sentence' data-sid='93-6-2-30'><span>如是我闻……</span></div>…</div></div>" }
    ],
    "pagination": { "page": 1, "pageSize": 6, "total": 6 }
  }
}
```

要点：

- 外层是项目统一信封 `{ ok, data, message }`，用现有 `unwrap()` 拆。
- `items` 是**逐段**的数组，每项 `{ para, display }`。这正是缓存按段落存的依据（§4）。
- **空段落会被服务端跳过**（`if (empty($paragraph['display'])) continue;`），
  所以 `items.length` 可能小于 `to - para + 1`。缓存层必须能区分
  「没请求过」和「请求过但服务端无内容」，否则每次进这一章都会重发请求。
  → 用 `html = ''` 的行记录「已确认为空」，见 §4.2。
- `display` 内的 `data-para` / `data-sid` 是既有阅读器 CSS 依赖的锚点
  （`src/screens/ReaderScreen.tsx` 的 `buildReaderHtml`），格式不变，直接拼接即可。
- 区间过大时服务端是 `foreach range()` 逐段查库，**没有上限保护**。
  客户端自己限制单次请求段数（建议 200 段一批，见 §5.2）。


## 3. 阅读单元切分算法

### 3.1 数据来源

只读库 `assets/db/tipitaka.db3`，单表 `pali_text`（523284 行 / 217 本书）：

```sql
CREATE TABLE pali_text (
  book INTEGER NOT NULL,
  paragraph INTEGER NOT NULL,
  level INTEGER NOT NULL,      -- 1..7 = 章节行；100 = 正文段落行
  toc TEXT,                    -- 章节标题；正文行为 NULL
  length INTEGER,              -- 本段字符数
  chapter_len INTEGER,         -- 本章节含多少段（正文行恒为 1）
  chapter_strlen INTEGER,      -- 本章节共多少字符（正文行 = length）
  parent INTEGER,              -- 父章节的 paragraph；顶层为 -1
  tags TEXT,
  cs_para INTEGER,
  book_name TEXT,
  PRIMARY KEY (book, paragraph)
)
```

**`level` 语义**：`level <= 7` 是章节标题行，`level = 100` 是正文段落行
（与 `src/catalog/commentary.ts` 的 `CHAPTER_MAX_LEVEL = 7` 一致）。
下沉时只在章节行之间走。

### 3.2 算法

**常量**：

| 常量 | 值 | 作用 |
|---|---|---|
| `READING_UNIT_MAX` | 5000 | 上限：章节体量低于它就停止下沉 |
| `READING_UNIT_MIN` | 1500 | 下限：区间低于它就向后扩展 |
| `CHAPTER_MAX_LEVEL` | 7 | `level <= 7` 为章节行 |

阈值判断口径**只看该章节自身的 `chapter_strlen`**，不累加起点到该章节的总量。

算法分两层：**核心切分**（下沉 / 硬切）+ **扩展**（区间过小时向后吞并）。
分层是必要的——扩展时对兄弟章节递归调用「完整算法」会连锁失控
（实测书 42 会一路吞到 66444 字符），扩展只能调用不再扩展的核心切分。

#### 核心切分 `coreUnit(book, startPara)`

```
from ← startPara                     # 起点固定不动，父标题与首个子标题之间的正文才不会漏

# 情形 0：起点是正文段（level > 7），即上一单元硬切后的续读位置
若 start.level > 7：
    bound ← start 所属章节（start.parent）的结束段
    return hardCut(from, bound)                        # mode = continuation

# 情形 1：下沉
cur ← startPara 所在章节行
循环：
    若 cur.chapter_strlen < 5000        → 跳出（体量合适）
    若 cur 无子章节行                    → return hardCut(from, chapterEnd(cur))   # mode = hardcut
    cur ← cur 的第一个子章节行（按 paragraph 升序）

# 情形 2：前置正文（起点标题 ~ 停止章节标题之间）本身就超阈值
若 cur.paragraph > from 且 sumLen(from, cur.paragraph - 1) >= 5000：
    return hardCut(from, chapterEnd(start))            # mode = preamble

return [from, chapterEnd(cur)]                         # mode = chapter
```

`chapterEnd(c)` = `c` 之后第一个 `level <= c.level` 的章节行的 paragraph − 1；
不存在则为本书最大 paragraph。

#### 硬切 `hardCut(from, bound)`

段落不可再分，所以按段落累加字符：

```
s ← 0；to ← from
for p in from..bound：
    s += length(p)；to ← p
    若 s >= 5000 → 跳出

# 剩下的尾巴不足下限就一并吞掉，否则下一单元只剩几十个字符
若 to < bound 且 sumLen(to+1, bound) < 1500：
    to ← bound

return [from, to]
```

#### 扩展 `readingUnit(book, startPara)`

```
u ← coreUnit(book, startPara)
若 u.mode ≠ chapter → 直接返回          # 硬切类已按字符填满，无需扩展

limit ← 起点的父章节的结束段（起点无父则用起点自身的结束段）
while sumLen(from, u.to) < 1500 且 u.to < limit：
    next ← paragraph = u.to + 1 处的章节行；不是章节行则停止
    sub  ← coreUnit(book, next.paragraph)      # 核心切分，不再扩展
    u.to ← min(sub.to, limit)
```

扩展边界取**父章节**而非起点自身：起点自身的边界太紧，中途翻页时扩不动，
会留下几十字符的单元。

#### 对应 SQL

```sql
-- 章节行（一次取整本，在内存里建索引；单本最多几千行）
SELECT paragraph, level, toc, chapter_strlen, parent
  FROM pali_text WHERE book = ? AND level <= 7 ORDER BY paragraph;

-- 段落字符数（sumLen / hardCut 用）
SELECT paragraph, length, level, parent
  FROM pali_text WHERE book = ? ORDER BY paragraph;
```

两条查询按书缓存在内存里，一本书只查一次。

### 3.3 实例

#### 书 93（DN 长部），起点 `para 3`（level 1）—— `chapter` 模式

| 步 | paragraph | level | chapter_strlen | toc | 判定 |
|---|---|---|---|---|---|
| 1 | 3 | 1 | 401733 | (DN) Sīlakkhandhavaggapāḷi | 超阈值，下沉 |
| 2 | 4 | 2 | 72542 | 1. Brahmajālasuttaṃ | 超阈值，下沉 |
| 3 | 5 | 4 | 4634 | Paribbājakakathā | **< 5000，停止** |

`para 5` 之后第一个 `level <= 4` 的章节行是 `para 12`，故 `to = 11`。
区间 **`93 / 3–11`，9 段，4674 字符**：段 3/4/5 是三级标题（自带层级上下文），
段 6–11 是 `Paribbājakakathā` 正文。

请求：`tipitaka-read-para?book=93&para=3&to=11&channel=…&format=html&view=display`

#### 书 33，起点 `para 2` —— `chapter` + 扩展

第一个子章节是 `para 3`（level **4**，`Paṭhamo bhāgo`，**13 字符**，一个分卷标记），
排在真正的 level-2 兄弟之前——层级不严格嵌套。停止后区间只有 26 字符，触发扩展：
吞 `para 4`（319 字符）仍不足 1500，再吞 `para 22` → 区间 **`2–288`，5354 字符**。

#### 书 190，起点 `para 3` —— `preamble` 模式

下沉到 `para 64`（4805 < 5000）停止，但 `para 3–63` 的**前置正文**有 3 万字符。
改为硬切 → 区间 **`3–21`，5196 字符**，`para 22` 起是下一单元。

#### 书 59，起点 `para 1` —— `hardcut` + `continuation` 连续翻页

整本只有一个 level-1 行、无子章节、28 万字符。硬切后连续翻页：

```
1-209    5013 字  [hardcut]
210-419  5008 字  [continuation]
420-569  5002 字  [continuation]
570-702  5003 字  [continuation]
```

### 3.4 全库校验

对 217 本书从头翻到尾，逐单元校验（脚本见 §6）：

```
单元总数 24607，字符 13~34212
模式分布 { chapter: 12389, continuation: 8783, hardcut: 3406, preamble: 29 }
✓ 全部终止、无倒挂、覆盖到书末（无空洞、无重叠）
```

首单元字符数分布（217 本）：

| 区间 | 本数 |
|---|---|
| < 1500 | 0 |
| 1500–5000 | 85 |
| 5000–20000 | 132 |
| > 20000 | 0 |

**残留的极端值，都是数据本身决定的，不再处理**：

- **最大 34212 字符**（书 37 `162–178`）：其中 `paragraph 178` **单段就有 30138 字符**
  （全库最长段落）。段落不可再分，硬切也切不动。
- **295 个单元不足 800 字符**（占 24607 的 1.2%）：位于父章节末尾，扩展受
  `limit`（父章节边界）限制无法继续吞并。跨父章节扩展会让「下一章」的语义错乱，
  不值得。

## 4. 缓存与离线下载

### 4.1 存储位置

**新建一个可写数据库**，与只读的 `assets/db/tipitaka.db3` **分开**：

| 文件 | 用途 | 读写 | 来源 |
|---|---|---|---|
| `tipitaka.db3` | 章节树 / `pali_text` | 只读 | 打包在 assets，随版本更新整体替换 |
| `reading.db3` | 正文缓存 + 下载状态 | 读写 | 首次启动时建表 |

分开的理由：`tipitaka.db3` 是随 App 版本替换的只读资产，一旦混入用户数据，
每次更新数据都要做数据迁移；分开后更新只是覆盖文件，用户缓存不受影响。

驱动用 `expo-sqlite`（**新增依赖，需重建 dev APK**）。
`src/catalog/commentary.ts` 已预留 `SqlRunner` 接口把驱动解耦，
Node 端校验脚本继续用 `node:sqlite`。

### 4.2 表结构

```sql
-- 正文缓存：按段落存，粒度与接口返回的 items 一致
CREATE TABLE IF NOT EXISTS para_html (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  para       INTEGER NOT NULL,
  html       TEXT    NOT NULL,   -- 接口的 display 字段；'' = 服务端确认无内容
  fetched_at INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY (channel, book, para)
);
CREATE INDEX IF NOT EXISTS idx_para_html_book
  ON para_html (channel, book, para);

-- 用户显式下载过的书（区别于阅读时被动产生的缓存）
CREATE TABLE IF NOT EXISTS download_state (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  status     TEXT    NOT NULL,   -- pending | downloading | paused | done | error
  total      INTEGER NOT NULL,   -- 该书正文段总数（本地算，见下）
  done       INTEGER NOT NULL,   -- 已缓存段数
  error      TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel, book)
);
```

**为什么 `html = ''` 要单独记一行**：接口会跳过空段落（§2）。若不记录，
每次进入含空段的区间都会重新请求那几段，永远命中不了缓存。

**为什么按段落而不按区间**：阈值可调、用户从目录/上一章/书签等不同入口
进入同一片正文，产生的区间互相重叠。段落是唯一稳定的复用单位。

### 4.3 读取流程

```
读区间 [from, to]：
  1. SELECT para, html FROM para_html
      WHERE channel=? AND book=? AND para BETWEEN ? AND ? ORDER BY para
  2. 与 [from, to] 求差，得到缺口段落
  3. 把缺口合并成连续子区间，逐个请求接口（单批上限 200 段）
  4. 一个事务内写回：返回的段写 display，请求了但没返回的段写 ''
  5. 按 para 升序拼接所有非空 html，交给 WebView
```

第 4 步「请求了但没返回的段写 `''`」是空段落记录的写入点。

### 4.4 整本下载与断点续传

进度不需要单独的状态机，**由数据本身推出来**：

```sql
-- 分母：该书正文段总数（只读库，离线可算）
SELECT count(*) FROM pali_text WHERE book = ? AND level = 100;

-- 分子：已缓存段数
SELECT count(*) FROM para_html WHERE channel = ? AND book = ?;
```

下载循环：

1. 按 200 段一批，从本书最小 paragraph 向后扫；
2. 每批开始前先查该批已缓存的段，**已有的跳过**（这就是断点续传——
   中断在哪都不用记，重启时自然从缺口继续）；
3. 每批写入是一个事务，进程被杀不会留下半截数据；
4. 每批结束更新 `download_state.done`，UI 据此显示百分比；
5. 暂停 / 取消 = 停止循环，已写入的数据全部有效，`status` 置 `paused`。

`download_state` 的作用是记录**用户主动下载过哪本书**，用于：

- 「已下载」列表与下载进度 UI；
- 清理缓存时**不误删**用户主动下载的书（§4.5）。

### 4.5 清理与配额

单书 HTML 约 1–5 MB，单频道全库 200 MB+，多频道叠加，必须有清理策略：

- **被动缓存**（阅读时产生，`download_state` 无记录的书）：按 `fetched_at`
  做 LRU，超过配额（建议 200 MB）时按书批量删除；
- **主动下载**（`download_state.status = 'done'`）：只在用户手动删除时清除；
- 按频道 / 按书删除各是一条 `DELETE`，删除后适时 `VACUUM`（SQLite 删数据
  文件不会自动缩小）。

统计所需的 SQL：

```sql
-- 各频道占用（近似，按 html 长度）
SELECT channel, count(*) paras, sum(length(html)) bytes
  FROM para_html GROUP BY channel;
```


## 5. 阅读位置与导航

### 5.1 进入阅读器的两种情形

| 情形 | 起点 |
|---|---|
| 从未读过这本书 | 本书第一个 `level = 1` 章节行的 paragraph |
| 读过（`src/data/history.ts` 有记录） | 记录里的 `paragraph`，即上次中断的阅读单元起点 |

`ReadingRecord.paragraph` 存的是**阅读单元的 `from`**，不是屏幕滚动位置。
`channelId` / `channelName` 已在记录里，切频道后继续读同一位置。

### 5.2 常量

| 常量 | 值 | 位置 |
|---|---|---|
| `READING_UNIT_MAX` | 5000 | 阅读单元字符上限（§3.2）|
| `READING_UNIT_MIN` | 1500 | 阅读单元字符下限，触发向后扩展（§3.2）|
| `CHAPTER_MAX_LEVEL` | 7 | 章节行 level 上限，复用 `commentary.ts` |
| `FETCH_BATCH_PARAS` | 200 | 单次接口请求的最大段数（§2）|
| `CACHE_QUOTA_BYTES` | 200 MB | 被动缓存配额（§4.5）|

### 5.3 上一单元 / 下一单元

导航按**阅读单元**走，不按目录章节走，保证与首屏用的是同一套切分：

- **下一单元**：起点 = 当前区间 `to + 1`，对该 paragraph 重跑算法。
  §3.4 已校验：从书首一路翻到书末，无空洞、无重叠、必然终止。
  注意起点可能是正文段（`level = 100`），算法的 `continuation` 分支处理这种情况。
- **上一单元**：算法是「从起点向后算」的，没有解析解。从本书首个 `level = 1`
  起点开始向后翻，直到某个单元的 `to + 1 == 当前 from`，该单元即上一单元。
  单本最多 400 个单元（§3.4 中位数远低于此），全部在内存索引上计算，无 IO。
  结果按 `(book, from)` 缓存。

目录抽屉里点某一章，则以该章的 paragraph 为起点重跑算法。


## 6. 实施进度

已完成 1–8（`npx tsc --noEmit` 通过，Metro 打包通过，
`node scripts/check-reading-unit.mjs` 全库校验通过）：

1. ✅ `expo-sqlite` + `expo-asset` 依赖；`metro.config.js` 把 `db3` 加进
   `assetExts`（默认只有 `db`，不加则 `require('…/tipitaka.db3')` 解析不到）。
   **两个都是原生模块，必须重建 dev APK 才能运行。**
2. ✅ `src/reading/db.ts`：拷贝 assets 里的只读库、打开 `reading.db3`、建表。
3. ✅ `src/reading/unit.ts`：§3.2 算法（纯函数 + 按书的内存索引）。
4. ✅ `src/reading/cache.ts`：§4.3 读取流程（查缓存 → 补缺口 → 事务写回）。
5. ✅ `src/api/read-para.ts`：`tipitaka-read-para` 客户端。
6. ✅ `src/reading/index.ts` 作为门面；`src/api/index.ts` 与 §1.2 列出的旧代码
   全部删除（`fetchChapterContent` / `fetchChapterByChannel` / `flattenReadHtml` /
   `getChapterContent` / `getChapterByChannel` / `mockGetChapterContent` /
   `mockGetChapterByChannel` / `mockDisplay` / `mockBody`），
   `src/catalog/headings.ts` 里被取代的 `resolveDisplayNode` /
   `nextHeading` / `prevHeading` / `chapterEndParagraph` /
   `CHAPTER_STR_LEN_THRESHOLD` 一并删除，避免两套切分逻辑并存。
7. ✅ `ReaderScreen` 改用阅读单元：`Reader` 路由的 `paragraph` 改为可选，
   起点由 `resolveStartParagraph` 统一决定（§5.1）；没带 `channelId` 时
   自动选第一个可读频道（新接口必须带 channel）。
8. ✅ `src/reading/download.ts`：§4.4 整本下载 + 进度 + 断点续传 + 暂停。

待做：

9. 书架接入下载入口与进度显示（`src/reading/download.ts` 已就绪，缺 UI）。
10. **后续**：`src/catalog/headings.ts` 由读 JSON 改为读 `pali_text`，
    删除 `src/data/tipitaka_heading.json`。目录抽屉目前是同步 API，
    改 SQLite 要一并改成异步，与本次改动解耦，单独做。

### 校验

§3.2 的算法是纯计算，Node 24 直接 import TS 源码跑，App 与脚本共用同一份实现，
不必等 APK 重建：

```
node scripts/check-reading-unit.mjs          # 全库校验 + 内置样例
node scripts/check-reading-unit.mjs 93 3     # 单个起点
node scripts/check-reading-unit.mjs 59       # 某本书连续翻页
```

§3.4 的数字即由它产出。

### 离线占位数据不入库

无后端时 `fetchReadParas` 回退 `mockReadParas`，但结果带 `mock: true`，
缓存层据此**不写盘** —— 否则占位文会冒充真经永久留在 `para_html` 里，
比一次加载失败糟得多。
