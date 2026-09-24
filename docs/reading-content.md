# 阅读内容获取、阅读单元切分与离线缓存

本文定义阅读器「拿到正文」这条链路的完整设计：**用哪个接口取数**、
**一次取多少（阅读单元切分算法）**、**取回来存在哪（缓存与离线下载）**。

替换掉的旧路径见 §1.2，新链路总览：

```
用户点书名
  └─ 本地 SQLite（pali_text）算出阅读单元区间 [from, to]      ← §3
      └─ 查缓存库（para_html），列出缺口段落                  ← §4
          └─ 缺口走 tipitaka-reading 接口（para/to 区间过滤）取数   ← §2
              └─ 区间里回来的段写 HTML、没回来的段写 NULL
                 （带过期时间），拼成 HTML 灌进 WebView
```


> 本文只管「正文」这一条链路。阅读页把**注释书（义注/复注）对应段落**段级内嵌进正文的设计见 [`docs/reading-annotations.md`](./reading-annotations.md) —— 它复用本文的取数接口与 `para_html` 缓存，不另建取数链路。

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


## 2. 数据接口：`tipitaka-reading`

后端实现：`mint/api-v13` `V3\TipitakaReadingController`（合并了旧的
`TipitakaReadChapterController` 与 `TipitakaReadParaController`）
客户端：`src/api/read-chapter.ts`（游标取数）、`src/api/read-para.ts`（区间取数）

一个端点两种用法。`book` / `chapter` / `para` / `to` 是**过滤**（都可选），
`after` / `page_size` / `unit` 是**游标分块**，`format` / `include` 是**渲染**：

```
GET /api/v3/tipitaka-reading/{channel}
    ?book=94             过滤：书（下载按书取整本）
    &chapter=3           过滤：章节起始段号（服务端按 chapter_len 展开）
    &para=7&to=7         过滤：段落区间（精确取段，与 chapter 互斥）
    &after=<cursor>      游标：取 meta.next_cursor 原样回传（不透明，勿自己拼）
    &page_size=3000&unit=byte
    &format=html&include=display
```

### 2.1 游标：`from` 换成 `after`

`from`（段号）不是被删掉，而是**换成** `after`（不透明游标）。四个原因按
重要性排：

1. **`from` 是「书内坐标」，新端点能跨书**。旧接口路径带 `book`，结果必在
   一本书内，`from=123` 唯一；新端点 `book` 降级成可选 filter —— 不带 `book`
   就是「取该 channel 全部译文」（下载场景要的正是这个），此时 `from=123` 问
   的是哪本书？游标必须是二元组，所以是 `after={book}-{para}`。
2. **`after` 不要求客户端做算术**。旧约定是 `last_para + 1` 当下次 `from`，
   但段号不连续（没译文的段被跳过），`+1` 只是碰巧能用、服务端还得顺延；新的
   是排他式游标，服务端在 `meta.next_cursor` 直接给字符串、客户端**原样回传**
   （不要自己拼）。
3. **实现从 offset 变 keyset，这是性能前提**。旧代码把整章译文段号拉成数组再
   找下标、`array_slice`，章节几百段能扛；去掉 `book` 过滤后结果集最大 52 万段
   （实测），那种做法就是 821ms / 281MB。`after` 直接翻译成一条行值比较
   `(book_id, paragraph) > (?, ?)`，走 `(book_id, paragraph, …)` 复合索引，3ms。
4. **顺带消掉两条 422**。旧 `from` 超出章节区间、或其后已无译文 → 422；`after`
   不需要这两条特例：它只是「排在它之后」的比较基准，指向的段存不存在、有没有
   译文都无所谓，取不到就是空 `data` + `next_cursor: null`。

`meta` 的 `first_para` / `last_para` / `remaining_para` / `current_para` /
`total_para` 换成 `next_cursor` / `total` / `remaining`：

- `next_cursor`：下一块游标，**为 null 表示取完**；
- `total` / `remaining`：过滤范围内已翻译的段数 / 本块之后还剩多少段有译文，
  **只在带 `book` 过滤时给**。

### 2.2 成片取数：整本书 / 整章节走游标（下载逻辑）

**阅读的成片情况只有两种**，其一就是「整本书 / 整章节」——用游标，与下载同
一条逻辑：`after=null` 从头取，之后把 `next_cursor` 原样传回，直到它为 null。
整本书用 `book` 过滤（分母直接取首块 `meta.total`，**不再逐章探测**；断点续传
把 `next_cursor` 存进 `download_state.cursor`）；只取某个章节就再加 `chapter`
过滤，服务端按 `chapter_len` 展开。

### 2.3 精确取一段：`para=<para>`

其二是「单个 para」——用 `para=<para>`（`to` 缺省即等于 `para`，只取一段），
AI 引文角标走的就是它：请求那段**有译文**才回、没有就是空，**不顺延**，问
`9102-7` 就只会回答 9102-7。阅读窗口补缺口是它的区间泛化（`para=from&to=to`，
按段号随机定位到窗口，同样不顺延），两者共用 `src/api/read-para.ts`。

### 2.4 响应

```json
{
  "data": [
    { "para": 287, "book": 94, "display": "<div id='para-287' class='translation' …>…</div>" }
  ],
  "meta": {
    "page_size": 3000, "page_size_unit": "byte",
    "next_cursor": "94-295",
    "total": 427, "remaining": 418
  }
}
```

`data` 里每段是 `{ para, display, book }`；`display` 为空的段会被服务端剔除。
`total` / `remaining` 只在带 `book` 过滤时出现。

> **信封**：新契约是 Laravel 资源集合原样输出（`{data, meta}`），错误走
> RFC 9457 Problem Details；仍在跑旧版本的实例外面还包一层
> `{ ok, data: { items, pagination }, message }`。`src/api/v3.ts` 的
> `unwrapV3Collection` 两种都认，拿不到期望的键就当契约不符报错 ——
> **不能静默当成空结果**，那会被缓存层写成「确认无内容」。

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

这是**阅读单元**的区间（决定一屏渲染哪些段）；取数按 §2 的章节接口走游标，
两者不必对齐 —— 取回来的块盖过窗口是常事，多出来的段进缓存等着下次滚动。

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
-- 正文缓存：按段落存，粒度与接口返回的条目一致
CREATE TABLE IF NOT EXISTS para_html (
  channel    TEXT    NOT NULL,
  book       INTEGER NOT NULL,
  para       INTEGER NOT NULL,
  html       TEXT,               -- 接口的 display 字段；NULL = 该版本没有这一段
  fetched_at INTEGER NOT NULL,   -- epoch ms
  expires_at INTEGER,            -- 空段占位的过期时间；非空正文为 NULL（永不过期）
  PRIMARY KEY (channel, book, para)
);

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

**为什么「没有」也要单独记一行**：块的覆盖区间里没回来的段就是「该版本没译
这一段」（§2.4）。若不记录，每次进入含空段的区间都会重新请求，永远命中不了
缓存 —— 而残缺的译本里空段是**多数**。

**为什么空段要带过期时间**（`EMPTY_PARA_TTL_MS = 48h`）：「没有」不是永久
结论，译者随时可能补上。非空正文 `expires_at = NULL` 永不过期；空段占位过期
后视同缺失，联网重取一次。旧库里没有 `expires_at` 列的行一律当已过期
（`src/reading/db.ts` 的 `ensureColumn` / `migrateParaHtmlNullable` 负责补列
与把老的空串迁成 NULL）。

**为什么按段落而不按区间**：阈值可调、用户从目录/上一章/书签等不同入口
进入同一片正文，产生的区间互相重叠。段落是唯一稳定的复用单位。

### 4.3 读取流程

```
读区间 [from, to]：
  1. SELECT para, html, expires_at FROM para_html
      WHERE channel=? AND book=? AND para BETWEEN ? AND ? ORDER BY para
     —— 非空正文直接命中；空段占位只在过期时间内算命中
  2. 与 [from, to] 求差，得到连续缺口
  3. 对每个缺口 [a, b] 调 §2 的区间接口（`para=a&to=b`）取数：
       区间里回来的段写 HTML，其余段写 NULL + 过期时间；
       区间超过一页就按 `next_cursor` 续传
  4. 每块一个事务（多值 INSERT 批量写：整段记空可达上万段，逐段过桥要好几秒）
  5. 按 para 升序拼接所有非空 html，交给 WebView
```

**首屏一段正文都没有怎么办**（`findFirstContent`）：残缺译本书首整片是空的，
窗口停在那里只有一串目录标题。用户正在读的那一层（`ReaderLayerPane` 的
`seekContent`）会往后找第一段真有正文的段，把窗口挪过去 —— 先扫缓存里
「从这里起连续解析过」的部分，扫到缺口才联网。义注/复注层不挪：它们的落点
是按原文层算出来的对应章节，挪走三层对读就错位了。

### 4.4 整本下载与断点续传

下载与阅读走同一端点，只是过滤与块大小不同：下载用 `book` 过滤 + 游标，
每块 **5000 字节**（服务端的字节上限，块越大往返越少）。

**进度条的分子分母**（`src/reading/download.ts`）：

| | 取值 | 为什么 |
|---|---|---|
| 分母 `total` | 首块的 `meta.total` | 该版本在本书**有译文**的段数 |
| 分子 `done` | `SELECT count(html) …`（非空段数）| 已经下到手的正文段数 |

分母不能用「本书段落总数」：残缺译本里多数段没有译文，按它算进度条会瞬间
冲到 90% 再原地不动，完全不反映实际下了多少内容。同理分子只数非空段。

下载循环：

1. 读 `download_state.cursor`（上次的 `next_cursor`）作为起点 —— 这就是断点
   续传：中断在哪都不用扫，重启后从游标继续；
2. `after` 取块、写回（items 写 HTML、两条译文之间的空档写 NULL），游标推进
   到 `next_cursor`；
3. 每块写入是一个事务，进程被杀不会留下半截数据；
4. 每块结束更新 `download_state.done` 与 `cursor`，UI 据此显示百分比；
5. `next_cursor == null` 即取完；暂停 / 取消 = 停止循环，已写入的数据全部
   有效，`status` 置 `paused`、游标保留。

整本取完时把 `done` 按 `total` 写满：服务端数的是「有句子的段」，客户端数的是
「渲染出正文的段」，个别段两边会差一点，不补的话进度条永远停在 99%。

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
-- 各频道占用（近似，按 html 长度）；count(html) 只数有正文的段，
-- 空段占位同样占一行，按 count(*) 算会把「扫过一遍但一段没译」算成有内容
SELECT channel, count(html) paras, sum(length(html)) bytes
  FROM para_html GROUP BY channel;
```


### 4.6 分块交给服务端

旧链路要在客户端按巴利文字符数分批（`FETCH_BATCH_STRLEN` / `FETCH_BATCH_MAX_PARAS`）
—— 段落大小差两个数量级（最短几个字符，最长 **30138**），按固定段数分批会让
批次体量在 24 K 到 321 K 字符之间摆动，1 MB 的 HTML 必然撞上
`src/api/client.ts` 的 12 秒超时。

`tipitaka-reading` 自带这件事：`page_size` + `unit=byte` 就是「按段落原文字节
数累加到上限即断块」，且服务端另有每块 200 段的硬上限管住偈颂类的书。客户端
只要给一个块大小，分批算法（`src/reading/batch.ts` 的 `planRanges`）与它的
校验脚本 `scripts/check-batch.mjs` 一并删除。

段落字符数（`pali_text.length`）仍然要用，但只用于**划阅读窗口**
（`src/reading/window.ts` 的 `paragraphLengths`），与取数无关。

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
| `CHAPTER_PAGE_SIZE` | 3000 | 阅读时每块的字节数（§2.2）|
| `DOWNLOAD_PAGE_SIZE` | 5000 | 下载时每块的字节数，服务端上限（§4.4）|
| `WINDOW_STRLEN` | 3000 | 阅读窗口每次扩展的巴利文字符数 |
| `EMPTY_PARA_TTL_MS` | 48 小时 | 空段占位的过期时间（§4.2）|
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

### 5.4 章节标题：该版本译出了就用译文

目录库 `pali_text.toc` 里的标题是**巴利文**，所有语种的用户看到的都是它。可标题
行本身也是一个段落，译者译了正文通常也把标题译了 —— 那段译文就躺在 `para_html`
里（接口对标题行同样返回 `display`）。

所以三处标题一律「**译出了用译文，没译才退回巴利 toc**」，逐条回退而不是整本
二选一 —— 残缺译本常常只译了前几章的标题：

| 位置 | 取值 |
|---|---|
| 顶部标题栏 | `headingTocFor()`：覆盖视口顶部段的最深层标题 |
| 正文大标题（`.doc-title`）| 同上，取载入时锚点段的 |
| 目录抽屉 / 宽屏目录栏 | `ChapterTree` 的 `titles` prop，逐行查 |

实现在 `src/reading/heading.ts`：`channelHeadingTexts()` 把本书全部标题段
（`level ≤ 7`）在 `para_html` 里查一遍，有正文的 `htmlToText()` 转成纯文本。
整本一次查完（标题行最多的一本书 2407 行，`IN` 分三条语句），之后滚动增量加载
时按新到的段落就地合并，不再查库。换版本 / 换书时随窗口重载重查。

⚠️ **译出的标题不能过巴利转写器**。正文的字体转换按 `class='original'` 判断
（`src/pali/script/html.ts`），标题是纯文本没有这个标记，所以 `ReaderDoc` 带一个
`titlePali` 标志：回退到巴利 toc 才转，译文原样显示。中文碰巧不受影响，英文
译名整条转写成缅文就是一串乱码。


## 6. 实施进度

已完成 1–11（`npx tsc --noEmit` 通过，Metro 打包通过，
`check-reading-unit.mjs` 全库校验通过，
真机（USB + dev build）已验证阅读、翻页、换版本、缓存命中、整本下载与进度）：

1. ✅ `expo-sqlite` + `expo-asset` 依赖；`metro.config.js` 把 `db3` 加进
   `assetExts`（默认只有 `db`，不加则 `require('…/tipitaka.db3')` 解析不到）。
   **两个都是原生模块，必须重建 dev APK 才能运行。**
2. ✅ `src/reading/db.ts`：拷贝 assets 里的只读库、打开 `reading.db3`、建表。
3. ✅ `src/reading/unit.ts`：§3.2 算法（纯函数 + 按书的内存索引）。
4. ✅ `src/reading/cache.ts`：§4.3 读取流程（查缓存 → 补缺口 → 事务写回）。
5. ✅ `src/api/read-chapter.ts`：`tipitaka-reading` 游标客户端（§2.2）；
   `src/api/v3.ts` 统一拆 v3 列表信封。`src/api/read-para.ts` **保留**，
   见 §2.3：区间过滤是唯一能精确取某一段的口子，引文角标要用。
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
9. ✅ 下载 UI 与入口：`DownloadControl`（进度环 + 状态 + 管理操作）与
   `DownloadIconButton`（图标 + 百分比）；入口三处 —— 版本列表每行、
   阅读器顶栏、阅读器设置弹层 / 书架「已下载」。
10. ✅ 取数改走 `tipitaka-reading`（§2）：`cache.ts` 用 `para`/`to` 区间补缺口、
    按区间记空段（带 48 小时过期时间），`download.ts` 用 `book` + 游标推进、
    按 `meta.total` 算进度、以 `next_cursor` 断点续传。
    客户端分批（`batch.ts` / `check-batch.mjs`）随之删除（§4.6）。
11. ✅ 首屏没有正文时挪到第一段真有正文的地方（§4.3 `findFirstContent`），
    只对用户正在读的那一层生效。

待做：

12. **后续**：`src/catalog/headings.ts` 由读 JSON 改为读 `pali_text`，
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

网络不可达时 `fetchReadParas` 回 `mock: true`（`fetchReadChapter` 回
`status: "offline"`），缓存层据此改用 `mockReadParas` 的占位文**只供当次显示、
不写盘** —— 否则占位文会冒充真经永久留在 `para_html` 里，比一次加载失败糟得多。
引文角标走的 `loadOnePara`（§2.3）连显示都不显示，直接回 null 提示取不到。
