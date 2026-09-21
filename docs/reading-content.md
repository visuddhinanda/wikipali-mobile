# 阅读内容获取、阅读单元切分与离线缓存

本文定义阅读器「拿到正文」这条链路的完整设计：**用哪个接口取数**、
**一次取多少（阅读单元切分算法）**、**取回来存在哪（缓存与离线下载）**。

替换掉的旧路径见 §1.2，新链路总览：

```
用户点书名
  └─ 本地 SQLite（pali_text）算出阅读单元区间 [from, to]      ← §3
      └─ 查缓存库（para_html），列出缺口段落                  ← §4
          └─ 缺口走 tipitaka-read-chapter 接口按游标取块      ← §2
              └─ 块里回来的段写 HTML、块覆盖到但没回来的段写 NULL
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


## 2. 数据接口：`tipitaka-read-chapter`

后端实现：`mint/api-v13/app/Http/Controllers/TipitakaReadChapterController.php`
客户端：`src/api/read-chapter.ts`

```
GET /api/v3/tipitaka-read-chapter
    ?book=94&para=3&from=3
    &channel=19f53a65-81db-4b7d-8144-ac33f1217d34
    &format=html&view=display&pagesize=3000&unit=byte
```

### 2.1 为什么成片取数换掉了 `tipitaka-read-para`

段落区间接口的语义是「给一段区间，**期待里面都有内容**」。可多数译本是残缺的
—— 译到哪算哪，中间大段大段没有。于是：

- 区间落在没译的地方 → 整批回空，客户端只能记下「这一段没有」再往后试；
- 一本书只有后半部有译文 → 从书首进去，前面每一批都是空的，
  **用户第一次点开书什么都看不到**。

实测书 94 配「庄春江工作站」频道：章节从段 3 起，第一段译文在 **287**。
旧链路从段 3 开窗口，前面 284 段一个字都没有。

章节接口把方向反过来：由服务端在章节范围内**只数有译文的段落**、按内容量
切块，每块都保证有内容；客户端要做的是从块的**覆盖区间**反推「哪些段确认
没有译文」。

### 2.2 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `book` | ✅ | 书 id |
| `para` | ✅ | **章节起始段号**。取数范围 = `[para, para + chapter_len - 1]` |
| `from` | | 游标，从这一段开始取；缺省 = `para`。落在没有译文的段上服务端顺延到其后第一段 |
| `channel` | ✅ | 频道 uuid |
| `format` | | `html` \| `markdown` \| `react` \| `text`，缺省 `html` |
| `view` | | `display`（整段合并）\| `sentences` \| `all`，缺省 `display` |
| `pagesize` | | 每块大小，本 App 固定 **3000**（服务端上限 5000 字节 / 200 段）|
| `unit` | | `para` 按段数、`byte` 按段落原文字节数累加；本 App 固定 **`byte`** |

**`para` 取哪一层**：本地 `pali_text` 里 `parent = -1` 的**顶层行**
（`src/reading/chapter.ts`）。全库 217 本校验过，顶层行首尾相接、
**不重不漏地平铺整本书**，每本 1–8 行，最长的一章 15943 段。

取最粗的一层而不是末层章节：接口每次调用都要在整个章节范围里数一遍
「该 channel 有多少段有译文」（进度条的分母），章节越碎调用次数越多。
顶层一本书最多 8 章，游标在章内一路推进，**块数由内容量决定而不是由目录
结构决定**。

### 2.3 响应

```json
{
  "data": [
    { "para": 287, "display": "<div id='para-287' class='translation' …>…</div>" },
    { "para": 288, "display": "…" }
  ],
  "meta": {
    "current_para": 3, "total_para": 427,
    "page_size": 3000, "page_size_unit": "byte",
    "book": 94, "chapter": 3,
    "first_para": 287, "last_para": 295, "remaining_para": 418
  }
}
```

meta 各键：

| 键 | 含义 |
|---|---|
| `current_para` | 请求的游标 `from` 原样回显 |
| `total_para` | 该 channel 在本章节内**有译文**的段落总数 —— 进度条的分母 |
| `page_size` / `page_size_unit` | 实际生效的块大小（超上限不报错，按上限算）|
| `book` / `chapter` | 回显 |
| `first_para` / `last_para` | 本块实际**覆盖**的段落闭区间 |
| `remaining_para` | `last_para` 之后本章节内还剩多少段有译文；0 即本章取完 |

> **信封**：新契约是 Laravel 资源集合原样输出（`{data, meta}`），错误走
> RFC 9457 Problem Details；仍在跑旧版本的实例外面还包一层
> `{ ok, data: { items, pagination }, message }`。`src/api/v3.ts` 的
> `unwrapV3Collection` 两种都认，拿不到 `first_para` / `last_para` 就当契约
> 不符报错 —— **不能静默当成空结果**，那会被缓存层写成「确认无内容」。

### 2.4 覆盖区间：客户端的立足点

`data` 可能比 `[first_para, last_para]` **短**：区间内渲染出来是空的段会被
剔出 `data`，但仍算在本块之内。续传必须按 `last_para` 推进，否则会卡在那一段
上原地打转。

客户端据此得到一条硬结论：

> **`[from, last_para]` 里没出现在 `data` 中的段，就是「该版本没有这一段」。**

游标与 `first_para` 之间那一截（例：`from=3`、`first_para=287`）同理 ——
服务端顺延过去了，说明中间全都没有译文。

`remaining_para = 0` 时再补一刀：本章节后面不会再有译文了，从 `last_para + 1`
到章节末尾一并记空，省掉下一次进来时那个只会换回 422 的请求。

### 2.5 两种「没有」

| 响应 | 含义 | 客户端动作 |
|---|---|---|
| `404` | 整个章节该 channel 一段译文都没有 | 整章记空 |
| `422` + `errors.from` | 游标在章节区间内，但它之后没有译文了 | 游标到章节末尾记空 |

两者都不是参数错误，是取数的正常终点。`src/api/client.ts` 的 `ApiError` 因此
带上了错误响应的 `body` —— 只看状态码分不出「参数写错了」和「这是边界」。

### 2.6 精确取一段仍然用 `tipitaka-read-para`

章节接口**不能回答「这一段有没有」**：游标落在没有译文的段上它会顺延到下一段
有译文的，问 `9102-7` 回的可能是 `9102-350`。

AI 回答里的引文角标要的恰好是「这一段，有就是有、没有就是没有」，所以
`src/api/read-para.ts` 保留，`loadOnePara`（`src/reading/cache.ts`）用它取单段：

```
GET /api/v3/tipitaka-read-para?book=9102&para=7&to=7&channel=…
```

区间接口不顺延，请求了却没回来就是「该版本没有这一段」。写回规则与阅读完全
一致（有正文写 HTML、没有写 NULL + 过期时间），两条路共用同一份 `para_html`：
读过的段点角标不再联网，点过角标的段进阅读器也直接命中。

它**只**用于单段取数 —— 成片取正文走章节接口，理由见 §2.1。

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
  2. 与 [from, to] 求差，得到缺口段落
  3. 游标落在第一个缺口上，反复调 §2 的章节接口取块：
       block → [游标, last_para] 里回来的段写 HTML，其余写 NULL + 过期时间
       empty → [游标, 章节末尾] 整段写 NULL + 过期时间
       游标推到 last_para + 1，跳过中间已缓存的段，直到盖过 to
  4. 每块一个事务（多值 INSERT 批量写：整章记空可达上万段，逐段过桥要好几秒）
  5. 按 para 升序拼接所有非空 html，交给 WebView
```

一块常常盖到 `to` 之外 —— 那些段已经写进缓存了，也一并返回给调用方，
省下一次滚动扩窗的往返。

**首屏一段正文都没有怎么办**（`findFirstContent`）：残缺译本书首整片是空的，
窗口停在那里只有一串目录标题。用户正在读的那一层（`ReaderLayerPane` 的
`seekContent`）会往后找第一段真有正文的段，把窗口挪过去 —— 先扫缓存里
「从这里起连续解析过」的部分，扫到缺口才联网。义注/复注层不挪：它们的落点
是按原文层算出来的对应章节，挪走三层对读就错位了。

### 4.4 整本下载与断点续传

下载与阅读走同一条链路，只有块大小不同：阅读 3000 字节（跟着窗口走，首屏要
快），下载 **5000 字节**（服务端的字节上限，块越大往返越少）。实测书 94
的 1557 段：3000 要 142 块 13.8 秒，5000 只要 91 块 10.8 秒。

**进度条的分子分母**（`src/reading/download.ts`）：

| | 取值 | 为什么 |
|---|---|---|
| 分母 `total` | Σ 各章节的 `meta.total_para` | 该版本在本书**有译文**的段数 |
| 分子 `done` | `SELECT count(html) …`（非空段数）| 已经下到手的正文段数 |

分母不能用「本书段落总数」：残缺译本里多数段没有译文，下载时它们只是被记成
空段，一个请求就能扫掉上千段 —— 进度条会瞬间冲到 90% 再原地不动，完全不反映
实际下了多少内容。同理分子只数非空段。

分母在开工时一次探清：每个顶层章节发一个 `pagesize=1&unit=para` 的小请求，
拿它的 `total_para` 累加（一本书最多 8 个章节）。**先探完再开下**，进度条的
分母就不会边下边变。探回来的那一段内容顺手也存下来。

下载循环：

1. 查该书**已解析且未过期**的段（`resolvedParas`），算出还缺哪些 ——
   这就是断点续传，中断在哪都不用记，重启时自然从缺口继续；
2. 逐章把游标落在第一个缺口上，按 §2 取块、写回，游标推到 `last_para + 1`；
3. 每块写入是一个事务，进程被杀不会留下半截数据；
4. 每块结束更新 `download_state.done`，UI 据此显示百分比；
5. 暂停 / 取消 = 停止循环，已写入的数据全部有效，`status` 置 `paused`。

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

章节接口自带这件事：`pagesize` + `unit=byte` 就是「按段落原文字节数累加到
上限即断块」，且服务端另有每块 200 段的硬上限管住偈颂类的书。客户端只要给
一个块大小，分批算法（`src/reading/batch.ts` 的 `planRanges`）与它的校验脚本
`scripts/check-batch.mjs` 一并删除。

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
5. ✅ `src/api/read-chapter.ts`：`tipitaka-read-chapter` 客户端（§2）；
   `src/api/v3.ts` 统一拆 v3 列表信封。`src/api/read-para.ts` **保留**，
   见 §2.6：它是唯一能精确取某一段的口子，引文角标要用。
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
10. ✅ 取数改走章节接口（§2）：`src/reading/chapter.ts` 给出取数章节
    （`parent = -1` 的顶层行），`cache.ts` 按游标补缺口、按覆盖区间记空段
    （带 48 小时过期时间），`download.ts` 按 `total_para` 算进度。
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

网络不可达时 `fetchReadChapter` 回 `status: "offline"`，缓存层据此改用
`mockReadParas` 的占位文**只供当次显示、不写盘** —— 否则占位文会冒充真经
永久留在 `para_html` 里，比一次加载失败糟得多。引文角标走的 `loadOnePara`
（§2.6）连显示都不显示，直接回 null 提示取不到。
