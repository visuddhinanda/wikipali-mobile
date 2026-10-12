# 下载管理重构（队列 / 后台 / 速度）

> 状态：**阶段 A 已实现**（2026-10-12，实现记录见 §13）；阶段 B（离线包）待后端接口。推荐路线见 §6.6。可交互原型：[`download-manager-preview.html`](./download-manager-preview.html)（浏览器直接打开）。
> 现行实现见 `docs/reading-content.md` §4.4（整本下载与断点续传），本文只讨论「下载管理」这一层：
> 队列、状态机、前后台生命周期、数据量 / 速度显示、UI。取数协议（`/v3/tipitaka-reading` 游标 + 5000 字节一块）不变。

---

## 1. 现状问题与根因

| # | 现象 | 根因（代码位置） |
|---|---|---|
| P1 | 频道页「全部下载」有计数器，但列表里只有一本是「排队中」，其余仍是「未下载」 | `ChannelDetailScreen.tsx:275` 在**页面里**用 `for … await downloadBook()` 一本一本发起：下一本要等上一本结束才交给下载层，所以下载层任一时刻只知道 1～2 本。计数器 `bulk` 是页面局部 state，不是队列的真实状态。 |
| P2 | App 切到后台下载就停；再打开时没下完的书显示「未下载」而不是「排队中」 | ① JS 在后台被系统挂起（iOS 约 30 秒，Android 视厂商/Doze 而定），`fetch` 失败或循环停住；② 冷启动 `reconcileDownloads` 把 `downloading/queued` 一律改成 `paused`，且**不会自动续**；③ P1 里还没轮到的书**从未写进 `download_state`**，重启后自然是「未下载」；④ 队列真源是内存里的 `chain / queuedKeys / pendingCount`，进程一死全丢。 |
| P3 | 没有数据量、速度显示 | `fetchChapterBlock` 只回 `nextCursor / total`（段数），下载层不统计字节；`download_state` 也没有字节字段。 |
| P4 | 「暂停」含义混在一起 | 用户点的暂停、切用户的「全部暂停」、进程被杀后的对账，都落成同一个 `paused`，无法区分「用户不想下」与「系统打断、应自动恢复」。 |
| P5 | 进度回调绑在组件上 | `downloadBook(…, onProgress)` 由发起它的组件持有回调；别的页面（书架、阅读页卡片）看到的是 DB 快照，刷新靠各自轮询/重进页面。 |

一句话：**队列活在内存和页面里，而不是活在数据库里**；状态机少了「系统等待」这一类状态。

---

## 2. 参照：主流下载管理的共同做法

调研对象：Android 系统 `DownloadManager`、Chrome / Firefox 下载页、IDM / Motrix / AB Download Manager（aria2 系）、
Spotify / YouTube / Kindle 等离线下载。共同点：

1. **点了就入队，立即可见**：批量下载一次性把 N 个任务全部写入队列，每个任务立刻显示「排队中」，而不是逐个发起。
2. **队列持久化**：队列存在磁盘上，进程被杀 / 重启后原样恢复，未完成的任务继续排队或自动续传。
3. **区分「暂停原因」**：Android `DownloadManager` 把暂停细分为 *等待网络 / 等待 Wi‑Fi（超出移动网络限额）/ 等待重试*；
   只有**用户主动暂停**的任务不会自动恢复，其余都是「系统等待」，条件满足后自动继续。
4. **并发上限可调**：默认 2～3 个同时下载，其余排队；队列可调整顺序（置顶 / 拖动）。（本项目受 expo-sqlite 约束，写库只能单写者，见 §5.2）
5. **失败自动重试**：网络错误按指数退避自动重试若干次，仍失败才进入「失败」并给「重试」按钮。
6. **数据量与速度**：每个任务显示「已下 / 总量 · 速度 · 剩余时间」，顶部有总速度与总剩余。
7. **全局入口**：有一个独立的「下载管理」页；进行中的下载在别的页面有轻量提示（徽标 / 横幅 / 系统通知）。
8. **网络策略**：默认只用 Wi‑Fi；在移动网络下发起下载时询问「立即下载 / 等待 Wi‑Fi」；设置里可改为移动网络也下载（详见 §8.5）。
9. **后台继续**：Android 用前台服务或 Android 14+ 的 *User‑Initiated Data Transfer（UIDT）* 作业，配常驻进度通知；
   iOS 用 `URLSession` background session（只能是**单个文件 URL** 的传输，跑不了 JS 循环）。

---

## 3. 设计目标

- G1 **入队即持久**：任何「下载」动作（单本 / 全部）立即写 DB，状态立刻可见；批量下载 N 本 = N 行 `queued`。
- G2 **DB 是队列唯一真源**：内存里只有「调度器正在跑哪几本」，其余全从 `download_state` 读；进程被杀不丢队列。
- G3 **用户暂停 ≠ 系统等待**：只有用户暂停不会自动恢复；后台、断网、等 Wi‑Fi、失败退避都会自动恢复。
- G4 **可见的数据量与速度**：单本与汇总都显示字节、速度、剩余时间。
- G5 **一个下载管理页** + 各处一致的状态（单一订阅源，不再各组件持回调）。
- G6 **后台尽力继续**：分阶段，先保证「不丢、能自动续」，再用服务端离线包 + 系统下载器实现两个平台的真后台（§6）。

---

## 4. 状态机

```
                 用户点「下载」/「全部下载」
     未下载 ───────────────────────────────▶ 排队中 (queued)
   (无记录 /                                  │ 调度器取到（并发未满、条件满足）
    pending)                                 ▼
        ▲             用户暂停          下载中 (downloading)
        │        ┌─────────────────────  │   │   │
        │        ▼                       │   │   │ 取完
        │   已暂停 (paused, reason=user)  │   │   ▼
        │        │ 用户继续 → 回排队中     │   │  已完成 (done)
        │                                │   │
        │   等待中 (waiting) ◀────────────┘   │ 错误
        │    reason = network | wifi |       ▼
        │             background | retry   重试 n 次（指数退避，期间 = waiting/retry）
        │    条件满足 → 自动回排队中            │ 仍失败
        │                                    ▼
        └──────── 删除 / 取消 ◀──────────── 失败 (error) ── 用户重试 → 排队中
```

| 状态 | 中文 | 自动恢复 | 进入条件 |
|---|---|---|---|
| `pending` | 未下载 | — | 无记录，或清数据后 |
| `queued` | 排队中 | — | 用户发起；等待条件满足；冷启动恢复 |
| `downloading` | 下载中 | — | 调度器开跑 |
| `waiting` | 等待中（+原因） | ✅ | 断网 `network`、在移动网络且未获允许 `wifi`（关了「连上 Wi‑Fi 时自动下载」的，连上 Wi‑Fi 后变 `wifi_ready`，等用户点开始）、App 在后台且无后台能力 `background`、失败退避 `retry`、切用户 `suspended` |
| `paused` | 已暂停 | ❌ | **仅**用户点暂停 / 全部暂停 |
| `error` | 失败 | ❌ | 自动重试耗尽（默认 3 次：5s / 30s / 2min） |
| `installing` | 正在安装 | — | 阶段 B：离线包已下完，正在解包写 `para_html`（只在前台进行；后台下完的显示「已下完 · 回到前台后安装」） |
| `done` | 已下载 | — | 游标取完 / 离线包安装完成 |

> 与现状的差别：新增 `waiting` + `pause_reason`；冷启动对账从「`downloading/queued` → `paused`」改为
> 「`downloading` → `queued`」（`paused` 仍是 `paused`），并按设置自动开跑。

---

## 5. 架构

### 5.1 模块划分

```
src/reading/download.ts          ← 保留：单本下载循环 runDownloadLoop（取块 / 写库 / 游标），改为可报告字节
src/reading/downloadManager.ts   ← 新增：调度器（单例）
                                    · enqueue(items[], batchId?)   批量一次性入队（一个事务）
                                    · pause / resume / cancel / retry / moveToTop / pauseAll / resumeAll
                                    · tick()：从 DB 取 queue_pos 最小的 queued，补满并发槽（阶段 A 恒为 1，见 §5.2）
                                    · 订阅 AppState / expo-network，切换 waiting ↔ queued
                                    · 速度采样（内存），对外 emit 快照
src/hooks/useDownloads.ts        ← 新增：订阅调度器快照（全局一个源，替代各组件 onProgress）
src/screens/DownloadsScreen.tsx  ← 新增：下载管理页（设置 → 下载管理，现入口 `settings.downloads` 尚无 route）
```

- 依赖方向不变：`screens/components → hooks → reading`；`reading` 不依赖页面。
- `ChannelDetailScreen.downloadAll` 改成一次 `enqueue(全部书, batchId)`，页面不再自己循环；计数器从 DB 按 `batch_id` 聚合。
- `BookDownloadCard / DownloadControl / DownloadIconButton` 改为读 `useDownloads()` 的那一行 + 调用调度器方法。

### 5.2 并发：单写者原则

**历史**：下载原本是「最多 2 本 + 排队」，因 expo-sqlite 在 Android 上并发原生调用触发
`NativeDatabase.xxxAsync rejected → NullPointerException`（expo/expo #50855），`ac40aae` 改为串行逐个下载；
随后 `2e06abd` 发现当时的全局串行队列靠 `inDbTask` 判断可重入、await 期间会被无关调用绕过，重构为
「唯一句柄 + 原生调用闸门 + 连接锁」（`src/reading/db.ts` 文件头、`docs/user-data-db.md` §8）。

**原则：SQLite 永远只有一个写者；要并发只能并发网络，不并发写库。**

| | 网络 | 写 `para_html` / `download_state` | 并发数 |
|---|---|---|---|
| **阶段 A（游标通道）** | 逐块 `fetch` | 每块一个事务 | **固定 1**，保持现状串行，不提供设置项 |
| **阶段 B（离线包通道）** | 系统下载器下文件，**完全不碰 SQLite** | 「安装队列」**单写者**逐本解包写库，每 500 行一个事务（中间让出连接锁，阅读页的读能插进来） | 下载 **2**（可调 1～3），安装 **固定 1** |

- 阶段 A 的体验问题（§1 P1～P5）**与并发数无关**：持久队列 + 「排队中」状态 + 自动恢复在并发 1 下全部成立。
  并发 1 的代价只是整批下载慢一些（一块 5000 字节，往返延迟占大头）。
- 阶段 A 若要提速，优先做**流水线**而不是多本并发：同一本书「写第 n 块」与「取第 n+1 块」重叠，网络等待
  不再空转，写库仍是单写者。前提是游标接口能在写库前就拿到 `next_cursor`（现在就是）。
- 是否放开阶段 A 的多本并发，要先在现在的闸门模型下**压测**（2 路下载 + 阅读页翻页 + 同步，在真机上跑一段时间，
  看有没有 NPE）。压测通过前不放开。
- 阶段 B 天然解决这个矛盾：网络并发交给系统下载器，SQLite 只有安装队列一个写者 —— 这也是推荐离线包的理由之一。

### 5.3 生命周期

| 时机 | 行为 |
|---|---|
| 冷启动（作用域解析完） | `downloading → queued`；若有 `queued` 且网络条件满足 → 自动开跑（设置「启动时自动继续」默认开） |
| 切到后台 | 游标通道：让在跑的循环**跑完当前块**后停（iOS 用 `beginBackgroundTask` 争取时间，见 §6），置 `waiting/background`；离线包通道（阶段 B）：系统下载器继续，不停；下完的包等回前台再解包写库 |
| 回到前台 | `waiting/background → queued`，`tick()` |
| 断网 / 恢复 | `expo-network` 监听：断网 → 在跑的转 `waiting/network`；恢复 → `queued` |
| 移动网络且未获允许 | 在下 / 排队的书 → `waiting/wifi`（`allow_cellular=1` 的除外）；连上 Wi‑Fi：「连上 Wi‑Fi 时自动下载」开 → `queued`，关 → `waiting/wifi_ready`。规则见 §8.5 |
| 切用户 | `pauseAll(reason=suspended)` → `waiting/suspended`；**按用户库分别保存**，切回该用户时恢复（取代现在的 `pauseAllDownloads` → `paused`） |
| 网络错误 | 退避重试：`waiting/retry` + `next_retry_at`；`tick()` 时到点的回 `queued` |

---

## 6. 取数通道：游标接口 vs 离线包

### 6.1 游标接口做下载的局限

`/v3/tipitaka-reading/{channel}` 的游标分页是为**在线阅读**设计的：一次取一章、取完即渲染，这条路没有问题。
把它当成**整本下载**的通道，会有这些结构性的局限（与 §1 的客户端问题无关，阶段 A 修不掉）：

| 局限 | 原因 |
|---|---|
| 往返太多 | 每块上限 5000 字节（服务端硬上限），一本书几百次请求；每次都有延迟、都可能失败 |
| iOS 无法真后台 | iOS 后台只能把**单个文件 URL** 交给系统下载器（background `URLSession`），JS 循环逐块取在后台跑不了 |
| Android 后台要保活 | 只能靠前台服务 / UIDT 撑住进程让 JS 循环继续跑，需要自写原生模块 |
| 总量未知 | 只有段数 `meta.total`，数据量、剩余时间只能估算 |
| 无版本 | 没有 ETag / 版本号，译文更新后无法判断已下载的书是否过期 |
| 服务器负担 | 几百次分页查询 + 渲染，远重于下发一个缓存好的文件 |

各平台后台能力（决定了为什么必须是「一个文件」）：

| 平台 | 能做什么 | 代价 |
|---|---|---|
| iOS | `beginBackgroundTask` 约 30 秒，够跑完当前块并落库；长时间后台只有 background `URLSession`，**只能下单个文件 URL**（Expo `File.createDownloadTask`，`sessionType: 'background'`；App 被杀后 JS 侧任务对象不恢复，需按文件落地情况对账） | 真后台必须有「整本一个文件」 |
| Android | 前台服务（`dataSync`，Android 15 起 24 小时内累计约 6 小时上限）或 Android 14+ **UIDT 作业**（用户发起的数据传输，须在 App 可见时调度、须挂通知、无固定时长上限） | 需原生模块 + config plugin（Expo 无现成 API）；`expo-background-task` 是 WorkManager 周期任务，最短 15 分钟，**不适合**持续下载 |

### 6.2 离线包：服务端生成「整本一个文件」

服务器为 `(channel, book)` 生成离线包，客户端交给系统下载器下载，下完再解包写库：

- **一次请求**，gzip 后体积显著变小（HTML 文本压缩率高）；
- **交给系统下载器**（iOS background `URLSession`、Android `DownloadManager` / UIDT）：App 被挂起甚至被杀，系统照样下完 —— 两个平台都是真后台，且**不需要自写保活模块**；
- `Content-Length` 直接给出**总量 / 进度 / 速度**；
- **断点续传走 HTTP Range**，不再自己维护游标；
- **ETag / 版本**可判断「有更新」，已下载的书能提示「有新版本，可更新」；
- 文件可走 CDN / 反向代理缓存，服务器几乎无负担。

**游标接口保留**：在线阅读继续用它；离线包接口不可用（旧服务器、生成失败、404）时，下载**回退到游标通道**；
将来也可用它做增量更新（只拉改过的段）。

### 6.3 接口草案（需与后端商定）

**① 查询离线包信息**（「全部下载」确认面板、检查更新用，可批量）

```
GET /v3/offline-packages?channel={channel_id}[&book=1,2,3]

200
{
  "data": [
    {
      "channel": "…uuid…",
      "book": 1,
      "level1_paras": [1, 418],          // 本 book 文件里的作品（level=1 段），便于 UI 说明「含 2 部作品」
      "paragraphs": 1520,                // 有译文的段数（= 现 meta.total）
      "bytes": 812345,                   // 压缩后文件大小（下载量）
      "raw_bytes": 3456789,              // 解压后大小（占用空间估算）
      "version": "2026-10-11T08:12:00Z", // 本书在该频道最后修改时间
      "etag": "\"c1-b1-1760170320\""
    }
  ]
}
```

**② 下载离线包**

```
GET /v3/offline-packages/{channel_id}/{book}.ndjson.gz
请求头：Accept-Language（沿用）、Authorization（私有频道需要）、If-None-Match、Range（续传）

200 / 206
Content-Type: application/x-ndjson
Content-Encoding: 不设（文件本身就是 .gz，避免中间层二次解压导致 Content-Length 失真）
Content-Length: 812345
ETag: "c1-b1-1760170320"
Accept-Ranges: bytes
Last-Modified: …

304 Not Modified   —— If-None-Match 命中，本地已是最新
```

**文件格式**：gzip 压缩的 NDJSON，一行一个 JSON。首行是头，其后每行一段：

```
{"type":"header","format":1,"channel":"…","book":1,"version":"2026-10-11T08:12:00Z","paragraphs":1520,"level1_paras":[1,418]}
{"type":"para","para":1,"html":"<p>…</p>"}
{"type":"para","para":2,"html":null}
…
{"type":"end","count":1520}
```

- 选 NDJSON 而不是 zip：只有一份数据，不需要多文件容器；可**边解压边逐行写库**，内存占用恒定；末行 `end` 用于校验文件完整。
- `html` 与现在 `/v3/tipitaka-reading` 的 `format=html&include=display` **渲染结果一致**，客户端写 `para_html` 的逻辑不变。
- `html: null` 表示该段没译文（对应 `para_html.html IS NULL` 的空段占位），是否下发由后端决定，客户端两种都兼容。
- 将来若要附带图片等资源，再升级为 zip（`format` 字段递增）。

**生成与缓存（服务端）**：

- **按需生成 + 缓存**，不预生成全量（译文持续在改，全量预生成很快过期）。缓存键 = `(channel, book, version)`；
  `version` = 该频道该书句子的最后修改时间，变了就失效重生成。
- 首次请求若生成耗时较长，可返回 `202 Accepted` + `Retry-After`，客户端按「等待中 · 服务器正在准备」处理后重试。
- 私有频道需鉴权；公开频道的包可走 CDN。

### 6.4 打包粒度

按 `(channel, book)` 打包，与 `download_state` 主键一致，最省事。

注意：一个 `book` 文件可能装多部作品（多个 level=1），按 book 打包会把同文件里的几部一起下下来 —— 这和现状
（游标接口按 `book` 过滤）一致，不是新问题。下载**同步锚点**仍按 CLAUDE.md 规则：从用户发起下载时所在段向上搜到
level=1（`anchor_para` 持久化，见 §9）。确认面板可用 `level1_paras` 提示「本册含 2 部作品」。

### 6.5 客户端流程（离线包通道）

```
入队 → 调度器开跑
  ├─ 查包信息（①，可在「全部下载」时批量查好）→ 得到 bytes / etag
  ├─ 交给系统下载器：File.createDownloadTask(url, 临时文件)
  │     · 进度 / 速度 ← bytesWritten / totalBytes
  │     · 暂停 → pauseAsync() + savable() 存进 download_state.resume_data
  │     · App 被杀 → 冷启动按临时文件是否完整 / resume_data 对账，必要时 Range 续传
  ├─ 下完：校验（gzip 完整 + 末行 end.count）
  ├─ 解包写库：边解压边按 500 行一批写 para_html（每批一个事务，避免长时间持锁卡住阅读）
  ├─ 写 download_state：status=done、etag、version → 入队 likes(type=download) 同步（不变）
  └─ 删临时文件
失败 / 接口不可用（404、旧服务器）→ 回退游标通道（现有 runDownloadLoop）
```

- **安装队列单写者**：多本包同时下完时逐本安装（其余显示「已下完 · 等待安装」），同一时刻只有一个写库循环（§5.2）。
- 解包写库是 JS 工作，必须在前台进行：系统下载器在后台把文件下完，**回到前台时**调度器发现「文件已就绪」，
  状态显示「已下载，正在安装…」，写完转 `done`。阶段性状态 `installing` 计入「进行中」。
- 更新：已下载的书定期（或进入书架时）用 ① 比对 `etag`，不同则在下载管理页显示「有更新」，用户点更新时带
  `If-None-Match` 重下。

### 6.6 推荐路线

| 阶段 | 内容 | 依赖 | 解决 |
|---|---|---|---|
| **A 客户端下载管理（先做）** | 持久队列、状态机、自动恢复、字节/速度、下载管理页；取数仍走游标通道，后台「跑完当前块再停、回前台自动续」 | 无 | §1 的 P1～P5 全部 |
| **B 离线包通道（推荐，与 A 并行推进后端）** | §6.2～6.5：系统下载器 + 解包写库；游标通道降为回退 | 后端 §6.3 接口 | 真后台（iOS + Android）、精确总量、版本更新、服务器负担 |
| C Android 保活（备选） | 本地 Expo module 声明前台服务 / UIDT，保活进程让游标循环后台继续 + 进度通知 | 原生模块，dev client 重建 | 仅在离线包迟迟不能落地时才做；B 上线后不需要 |

A 的调度器与 B 的「取数通道」是两层：调度器（队列 / 状态 / UI）不关心用哪个通道取数，B 上线只是替换
`runDownloadLoop` 背后的实现，上层不用改。

---

## 7. 数据量、速度、剩余时间

**字节统计**（阶段 A 就能做）：

- 每块响应在 `src/api/read-chapter.ts` 里记下**传输字节数**（优先 `Content-Length`，没有则按响应文本长度），随 `fetchChapterBlock` 一起返回；
- `download_state.bytes` 累加（续传时接着加）；
- **总量估算**：服务器若给 `meta.total_bytes` 直接用；否则按「已下字节 / 已下段数 × 总段数」估算，标「约」字；首块之前显示「计算中」。

**速度**（只在内存里，不落库）：

- 每个在跑任务记最近 5 秒的 `(时间, 字节)` 样本，速度 = 窗口内字节 / 时长，再做一次 EMA 平滑（α≈0.3），避免一块一块地跳；
- 汇总速度 = 各在跑任务之和；剩余时间 = 剩余字节 / 汇总速度，>1 小时显示「约 1 小时以上」，速度 < 1 KB/s 显示「—」。

**单本状态行**（原型里的样式）：

```
下载中 · 1.2 MB / 约 3.4 MB · 180 KB/s · 剩 12 秒
排队中 · 第 3 位
等待中 · 等待 Wi‑Fi        [用移动网络下载]
等待中 · 网络错误，30 秒后重试（第 2 次）
已暂停 · 1.2 MB / 约 3.4 MB   [继续]
失败 · 服务器无响应           [重试]
已下载 · 3.4 MB · 10月12日
```

**存储占用**：「已下载」分组标题显示该频道合计占用（`sum(length(html))`，与 `reading-content.md` §4.5 同一 SQL）；页面底部显示总占用与设备剩余空间（`expo-file-system` `Paths.availableDiskSpace`）。

---

## 8. UI 设计

原型见 [`download-manager-preview.html`](./download-manager-preview.html)，四个场景可切换。

### 8.1 频道页「全部下载」

1. 点「全部下载」→ 底部确认面板：
   `将下载 42 本 · 约 86 MB（已下载 3 本将跳过）`，按钮「开始下载」/「取消」。
   在移动网络且未允许移动网络下载时，换成 §8.5 的移动网络确认面板。
2. 确认后**一次性入队**：列表里 42 本立刻全部变成「排队中」（前 2 本「下载中」）。
3. 原「全部下载」按钮变成批次进度：`下载中 5/42 · 1.2 MB/s ›`，点它进入下载管理页；旁边保留「全部暂停」。
4. 离开页面、切后台、重启都不影响；回来按 `batch_id` 从 DB 聚合计数。

### 8.2 下载管理页（新）

```
┌ 下载管理                          [编辑] ┐
│ ┌汇总卡────────────────────────────────┐ │
│ │ 3 本下载中 · 12 本排队               │ │
│ │ ▓▓▓▓▓▓░░░░░░  18.2 / 约 86 MB        │ │
│ │ 1.6 MB/s · 剩约 42 秒                │ │
│ │ [全部暂停]              仅 Wi‑Fi 下载 │ │
│ │ 3 本等待 Wi‑Fi   [使用移动网络下载]  │ │
│ └──────────────────────────────────────┘ │
│ 进行中 (15)                              │
│  书名 / 频道           ◔ 暂停           │
│  下载中 · 1.2/3.4 MB · 180 KB/s         │
│  书名 / 频道           ⋯                │
│  排队中 · 第 1 位                       │
│ 已暂停 / 失败 (2)          [全部继续]    │
│ 已下载 (24)        按频道分组 · 占 120 MB │
└──────────────────────────────────────────┘
```

- 分组：**进行中**（下载中 + 等待中 + 排队中，按 queue_pos）→ **已暂停 / 失败** → **已下载**（按频道折叠，显示占用）。
- 行内主按钮随状态变：下载中/排队中 → 暂停；已暂停 → 继续；失败 → 重试；已下载 → 打开阅读。
- 行的「⋯」菜单：置顶（排到队首）、取消下载（删已下数据，回未下载）、删除（已下载的：仅删数据 / 删数据和记录，沿用现有两种删除）。
- 编辑模式：多选 → 批量暂停 / 继续 / 删除。
- 顶部汇总卡：总进度、总速度、剩余时间、「全部暂停 / 全部继续」、当前网络策略（「仅 Wi‑Fi 下载」/「移动网络也下载」，点 ⚙ 修改）；有书在等 Wi‑Fi 且当前是移动网络时，多一行「N 本等待 Wi‑Fi [使用移动网络下载]」。
- 空态：「暂无下载」+ 去分类页挑书。

### 8.3 全局提示

- 书架「已下载」tab 顶部：有进行中任务时显示一条横幅 `正在下载 3 本 · 1.6 MB/s ›`，点进下载管理页。
- 「我」→ 设置 → 下载管理 行尾显示进行中数量徽标。
- 阶段 B（离线包）：系统下载器自带通知栏进度（Android `DownloadManager` 通知 / UIDT 通知；iOS 无通知栏，回前台可见）。
- 后台回来若有任务被系统打断后自动恢复，不弹窗；只有**失败**时给一次 toast：「2 本下载失败，可在下载管理重试」。

### 8.4 设置项（下载管理页右上 ⚙）

| 项 | 默认 |
|---|---|
| 使用移动网络下载 | **关**（= 仅 Wi‑Fi；移动网络下点下载会先询问） |
| 连上 Wi‑Fi 时自动下载 | 开 |
| 同时下载数 1 / 2 / 3 | 阶段 A 不提供（固定 1）；阶段 B 为 2（只影响系统下载器，安装始终逐本） |
| 失败自动重试 | 开（3 次） |
| 启动时自动继续未完成的下载 | 开 |
| 后台继续下载（阶段 B 离线包可用时） | 开 |

---

### 8.5 移动网络下载确认

**需求**：默认只用 Wi‑Fi 下载。在移动网络下点「下载」或「全部下载」时先询问，用户选「立即下载 / 仅加入队列 / 取消」；
可设置「连上 Wi‑Fi 时自动下载」；设置成移动网络也下载的，就不再询问。

**社区通行做法**（命名与交互依据）：

| 产品 | 设置项 | 移动网络下发起下载时 |
|---|---|---|
| Google Play | 「应用下载偏好设置」：*通过任意网络 / 仅限 WLAN / 每次都询问* | 弹窗二选一：**「立即下载」/「等待 WLAN」**（选后者进队列，连上 Wi‑Fi 自动开始） |
| iOS App Store | 「蜂窝数据 → 应用下载」：*始终允许 / 超过 200 MB 时询问 / 始终询问* | 超过阈值时弹窗确认是否用蜂窝数据下载 |
| Spotify | 开关 **「使用移动数据下载」**（Download using cellular），默认关 | 关时只在 Wi‑Fi 下下载 |
| Netflix | 开关 **「仅 Wi‑Fi」**（Wi‑Fi Only），默认开 | 关时可用移动数据下载 |

取舍：

- **设置用正向开关**「使用移动网络下载」，默认**关**（与 Spotify 一致；Netflix 的「仅 Wi‑Fi」是反向表述，开关语义容易看反）。
  不做 iOS 那种三档（始终允许 / 超过 X MB 询问 / 始终询问）：单本只有 1～5 MB，阈值意义不大；「全部下载」不论大小都会弹确认面板、显示总量。
- **询问弹窗沿用 Google Play 的「立即下载 / 等待 Wi‑Fi」**：「等待 Wi‑Fi」比「仅加入队列」更直接地说明会发生什么、什么时候开始。
- **「不再询问」复选框**（Android 常见做法，用户能一步到位）：只对「立即下载」生效，勾上即把设置「使用移动网络下载」打开，并 toast 告知「可在下载设置中关闭」—— 让用户知道去哪儿改回来。
- 文案用「移动网络」「Wi‑Fi」（与系统设置和国内 App 一致；Google Play 中文版用「WLAN」，这里不跟）。

**移动网络确认面板**（底部面板；单本和「全部下载」共用，全部下载多显示本数 / 跳过数）：

```
┌──────────────────────────────────────┐
│ 正在使用移动网络                      │
│ ┌──────────────────────────────────┐ │
│ │ 下载 10 本将使用约 26.4 MB 移动数据。│ │
│ └──────────────────────────────────┘ │
│ 将下载 10 本 · 已下载（跳过）2 本     │
│ [          立即下载          ]  主按钮 │
│ [          等待 Wi‑Fi         ]  次按钮 │
│              取消                文字按钮 │
│ ☐ 以后都用移动网络下载，不再询问      │
│ 「等待 Wi‑Fi」会先加入队列，连上 Wi‑Fi │
│  后自动开始。可在 下载管理 → ⚙ 中修改。│
└──────────────────────────────────────┘
```

- 三个动作竖排（Material 规范：按钮文字较长、超过两个动作时竖排；主操作在上）。点遮罩 = 取消。
- 何时弹：`当前是移动网络 && 设置「使用移动网络下载」关`。Wi‑Fi 下单本直接入队；「全部下载」在 Wi‑Fi 下弹的是普通确认面板（§8.1）。
  断网时不弹，直接入队为「等待网络」。

**各选项的结果**：

| 选择 | 结果 |
|---|---|
| 立即下载 | 入队，这些书标 `allow_cellular=1`：本次在移动网络下照常下载；之后设置怎么改都不影响已放行的这批 |
| 立即下载 + 勾「不再询问」 | 同上，并把设置「使用移动网络下载」打开 |
| 等待 Wi‑Fi | 入队，状态「等待中 · 等待 Wi‑Fi」；toast「已加入队列，连上 Wi‑Fi 后自动下载」（自动下载关时为「…连上 Wi‑Fi 后在下载管理中开始」） |
| 取消 | 不入队，什么都不变 |

**网络切换时**：

| 场景 | 行为 |
|---|---|
| Wi‑Fi → 移动网络（设置关） | 在下 / 排队的书转「等待 Wi‑Fi」（`allow_cellular=1` 的继续下）；不弹窗（不是用户发起的操作），下载管理页汇总卡显示「N 本等待 Wi‑Fi [使用移动网络下载]」 |
| 移动网络 → Wi‑Fi，「连上 Wi‑Fi 时自动下载」开 | 「等待 Wi‑Fi」→ 排队中，自动开始 |
| 移动网络 → Wi‑Fi，自动下载关 | 停在「等待中 · 已连上 Wi‑Fi，点 ▶ 开始」，用户点 ▶（或「全部继续」）才开始 |
| 用户在「等待 Wi‑Fi」的书上点「使用移动网络下载」（行菜单 / 汇总卡按钮） | 标 `allow_cellular=1`，立即排队；这是用户明确的操作，不再二次询问 |

**「连上 Wi‑Fi 时自动下载」的实现分阶段**：

- 阶段 A（现在就能做）：只在 **App 在前台**时生效。`expo-network` 的 `addNetworkStateListener` 监听网络类型变化，
  变成 `WIFI` 时调度器 `tick()`；冷启动 / 回到前台时也检查一次。设置项说明写明「目前需 App 在前台」。
- 阶段 B（离线包）：把网络条件交给系统下载器 —— Android `DownloadManager.Request.setAllowedNetworkTypes(NETWORK_WIFI)` /
  UIDT `setRequiredNetworkType(NETWORK_TYPE_UNMETERED)`、iOS `URLSessionConfiguration.allowsCellularAccess = false`，
  App 在后台也能在连上 Wi‑Fi 时自动开始。Expo `File.createDownloadTask` 是否暴露这些选项需实现时确认，不暴露则需小的原生补充。
- 判定「移动网络」：用 `expo-network` 的 `NetworkStateType.CELLULAR`。手机热点这类按流量计费的 Wi‑Fi 在 JS 层识别不出来，阶段 A 按 Wi‑Fi 处理；阶段 B 用 `UNMETERED` 约束可以覆盖到。

**i18n 文案草案**（zh-Hans；en 参照 Google Play / Spotify 的说法）：

| 文件 | key | zh-Hans | en |
|---|---|---|---|
| messages | `download.cellular.title` | 正在使用移动网络 | You're on mobile data |
| messages | `download.cellular.body` | 下载{what}将使用约 {size} 移动数据。 | Downloading {what} will use about {size} of mobile data. |
| messages | `download.cellular.queuedToast` | 已加入队列，连上 Wi‑Fi 后自动下载 | Added to queue. Will download on Wi‑Fi. |
| messages | `download.cellular.queuedManualToast` | 已加入队列，连上 Wi‑Fi 后在下载管理中开始 | Added to queue. Start it in Downloads when on Wi‑Fi. |
| messages | `download.cellular.enabledToast` | 已开启「使用移动网络下载」，可在下载设置中关闭 | Download using mobile data is on. You can turn it off in download settings. |
| messages | `settings.download.cellular.desc` | 关闭时，在移动网络下点下载会先询问 | When off, you'll be asked before downloading on mobile data |
| messages | `settings.download.autoWifi.desc` | 「等待 Wi‑Fi」的书在连上 Wi‑Fi 后自动开始（目前需 App 在前台） | Books waiting for Wi‑Fi start automatically when connected (app must be open for now) |
| labels | `settings.download.cellular` | 使用移动网络下载 | Download using mobile data |
| labels | `settings.download.autoWifi` | 连上 Wi‑Fi 时自动下载 | Download automatically on Wi‑Fi |
| labels | `download.waiting.wifi` | 等待 Wi‑Fi | Waiting for Wi‑Fi |
| labels | `download.waiting.wifiReady` | 已连上 Wi‑Fi，点 ▶ 开始 | On Wi‑Fi · Tap ▶ to start |
| labels | `download.cellular.dontAsk` | 以后都用移动网络下载，不再询问 | Always use mobile data, don't ask again |
| buttons | `download.now` | 立即下载 | Download now |
| buttons | `download.waitForWifi` | 等待 Wi‑Fi | Wait for Wi‑Fi |
| buttons | `download.useCellular` | 使用移动网络下载 | Use mobile data |

---

## 9. 数据模型变更（`download_state` 迁移）

```sql
ALTER TABLE download_state ADD COLUMN pause_reason TEXT;      -- user | network | wifi | wifi_ready | background | retry | suspended
ALTER TABLE download_state ADD COLUMN allow_cellular INTEGER DEFAULT 0; -- 用户在移动网络确认里点过「立即下载」/「使用移动网络下载」（§8.5）
ALTER TABLE download_state ADD COLUMN queue_pos INTEGER;      -- 排队顺序，置顶 = min-1
ALTER TABLE download_state ADD COLUMN batch_id TEXT;          -- 「全部下载」批次，用于计数器聚合
ALTER TABLE download_state ADD COLUMN bytes INTEGER DEFAULT 0;      -- 已传输字节
ALTER TABLE download_state ADD COLUMN total_bytes INTEGER;          -- 服务器给的或估算的总量
ALTER TABLE download_state ADD COLUMN attempts INTEGER DEFAULT 0;   -- 连续失败次数
ALTER TABLE download_state ADD COLUMN next_retry_at INTEGER;        -- 退避到点时间
ALTER TABLE download_state ADD COLUMN anchor_para INTEGER;          -- 入队时的锚点段（现为调用参数，进程重启会丢）
ALTER TABLE download_state ADD COLUMN enqueued_at INTEGER;
-- 阶段 B（离线包通道）
ALTER TABLE download_state ADD COLUMN transport TEXT;          -- package | cursor（本次实际用的取数通道）
ALTER TABLE download_state ADD COLUMN etag TEXT;               -- 已下载包的 ETag，检查更新 / If-None-Match
ALTER TABLE download_state ADD COLUMN version TEXT;            -- 包头 version（该书在该频道的最后修改时间）
ALTER TABLE download_state ADD COLUMN resume_data TEXT;        -- 系统下载器暂停态（DownloadTask.savable() 的 JSON）
ALTER TABLE download_state ADD COLUMN temp_file TEXT;          -- 下载中的临时文件路径（冷启动对账用）
```

- `status` 取值加 `waiting`，阶段 B 再加 `installing`（包已下完、正在解包写库）；旧数据 `paused` 视为 `pause_reason='user'`。
- `anchor_para` 必须持久化：现在 `anchorParagraph` 只是函数参数，排队中的书重启后丢失锚点，完成时的同步锚点会退回「第一个 level=1」，违反 CLAUDE.md 的锚点规则（一个 book 文件可能有多部作品）。
- 两个下载设置（`cellularAllowed` 默认 false、`autoOnWifi` 默认 true）放 `src/settings/`，按设备存、不随账号同步（网络习惯是设备属性）。
- 同步不变：仍只在 `done` 时入队 `likes(type=download)`；新字段都是本地字段，不上服务器。
- 迁移写进 `docs/user-data-db.md` 的迁移章节（实现时更新）。

---

## 10. 服务端 API 缺口

| 需求 | 用途 | 阶段 |
|---|---|---|
| **离线包信息** `GET /v3/offline-packages?channel=&book=`（§6.3 ①） | 「全部下载」确认面板一次算总量；检查已下载的书是否有更新 | B（A 阶段可先用下一行顶着） |
| **离线包下载** `GET /v3/offline-packages/{channel}/{book}.ndjson.gz`（§6.3 ②：`Content-Length`、`ETag`、`Range`、`304`） | 系统下载器真后台；精确进度；续传；版本更新 | B |
| `/v3/tipitaka-reading/{channel}` 的 `meta` 加 `total_bytes`（近似即可） | 游标通道的总量 / 剩余时间（离线包上线后仅回退通道用） | A（可选，没有也能估算） |

## 11. 实施分期与改动清单

**阶段 A（建议先做，一个主题一个 commit）**

1. 数据层：`download_state` 迁移 + `downloadManager.ts` 调度器 + 冷启动 / 前后台 / 网络对账；`download.ts` 循环改为调度器驱动、上报字节。
2. 订阅：`useDownloads()`；三个下载控件改用它。
3. 页面：`DownloadsScreen`（设置 → 下载管理接 route）、频道页「全部下载」改批量入队 + 确认面板、书架横幅。
4. i18n：新增文案（等待原因、速度/剩余时间格式、确认面板、设置项），8 个 locale。
5. 自检：`scripts/check-download-queue.mjs`（纯 node 模拟调度：入队 42 本 → 杀进程 → 恢复后仍 40 本 queued、无 pending 丢失）。
6. 测试：`docs/testing.md` 加「下载管理」清单（全部下载入队、切后台/回前台、断网、移动网络询问三个选项、Wi‑Fi ↔ 移动网络切换、自动下载开/关、杀进程重启、切用户）。

**阶段 B（离线包通道，后端接口到位后）**

1. 后端：§6.3 两个接口 + 按需生成与缓存（服务端仓库单独排期）。
2. `src/api/offline-package.ts`：包信息查询；`src/reading/packageInstall.ts`：校验 + 流式解压 + 分批写 `para_html`。
3. 调度器加「取数通道」抽象：优先离线包，404 / 不支持时回退游标通道；`download_state` 迁移加 §9 阶段 B 字段。
4. 下载管理页：`installing` 状态（「正在安装…」）、「有更新」标记与「更新」按钮。
5. 自检：`scripts/check-offline-package.mjs`（用本地服务器生成的包，校验行数 / end.count / 与游标通道写库结果逐段一致）。

**阶段 C（备选）**：Android 原生保活模块 + 进度通知，仅在阶段 B 无法落地时做（单独评审原生改动）。

---

## 12. 待确认

1. 阶段 A 固定并发 1（§5.2）是否接受？是否要做「取下一块与写当前块重叠」的流水线提速？阶段 B 的系统下载器并发默认 2 是否可以？
2. 移动网络询问是否还要加「超过 X MB 才询问」一档（iOS App Store 做法）？当前方案：设置关 = 每次询问，开 = 从不询问（§8.5）。
3. 离线包接口（§6.3）的路径、字段、格式（gzip NDJSON）与后端确认；`html: null` 空段是否下发。
4. 离线包按需生成的首次耗时：是否需要 `202 + Retry-After` 的异步准备流程，还是同步生成即可。
5. 解包写库与正文缓存是否需要 Expo 的流式 gzip 能力（`DecompressionStream` 在 Hermes 上是否可用待验证；不可用则需要一个 JS 解压库，如 `fflate`）。
6. 阶段 C（Android 保活原生模块）是否还需要保留为备选。

---

## 13. 阶段 A 实现记录（2026-10-12）

**代码位置**

| 文件 | 内容 |
|---|---|
| `src/reading/downloadPolicy.ts` | 纯决策：状态 / 等待原因、`blocker` / `settle` / `pickNext`、退避间隔、测速 `SpeedMeter`、总量估算（`scripts/check-download-queue.mjs` 直接跑） |
| `src/reading/download.ts` | 存储层（入队、改状态、置顶、对账、删除）+ 单本下载循环 `runBook`（逐块取数、记字节） |
| `src/reading/downloadManager.ts` | 调度器单例：单写者、AppState / `expo-network` / 设置 / 作用域监听、退避定时、快照订阅 |
| `src/hooks/useDownloads.ts` | 快照订阅：`useDownloadRow`（单行）/ `useDownloadRows` / `useRunningDownload`（速度） |
| `src/settings/download.ts` | 两个下载设置（AsyncStorage） |
| `src/components/DownloadPromptHost.tsx` + `downloadRequest.ts` | 全局确认面板（Wi‑Fi 下全部下载确认 / 移动网络询问）与发起下载的统一入口 |
| `src/components/downloadText.ts` | 字节 / 速度 / 剩余时间 / 状态行文案 |
| `src/screens/DownloadsScreen.tsx` | 下载管理页（SectionList，底部是下载设置） |
| `ChannelDetailScreen` / `BookshelfScreen` / `BookDownloadCard` / `DownloadIconButton` | 改为读快照；频道页「全部下载」批量入队 + 批次条；书架「已下载」状态条 / 频道副标题 / 占用；已下载的卡片整行进阅读、右侧删除图标 |

旧的 `DownloadControl.tsx`（无引用）已删除；`downloadBook` / `isDownloading` / `reconcileDownloads` 等旧接口由调度器接口取代。

**与方案稿的差异**

- 确认面板**不显示数据量**：没有 §10 的体量接口前，未下载的书估不出字节；只显示本数 / 跳过数。下载开始后按「已下字节 / 已下段数 × 总段数」估算（标 `~`）；汇总卡在还有没开工的书时不显示总量和剩余时间。
- 下载设置放在下载管理页底部（不是右上 ⚙ 弹层），书架「已下载」底部「下载管理 ›」直达。
- 「同时下载数」不提供（阶段 A 固定 1，§5.2）。
- 分类 → 频道页（浏览模式）的「下载」入口未做（待定，见上轮讨论）。

**实现中踩到的坑（必须保持）**

1. **快照要做结构共享**：排队几百本时，每块 / 每秒的刷新若让所有订阅者重渲染，dev 包 JS 线程会被占满（CPU 120%、点击无响应）。现在：没变的行沿用旧对象、只有速度变时行数组引用不变；卡片按单行订阅并 `React.memo`；下载管理用 `SectionList` 虚拟化；速度只由汇总卡 / 正在下载那行 / 批次条订阅。
2. **Fast Refresh 会重跑调度器模块**（开发时）：旧实例必须停循环、退订监听（`module.hot.dispose`），新实例自行 `initDownloadManager`，否则会出现两个调度器同时写库，或页面订阅到一个未启动的实例（快照为空）。
3. `loadDownloadSettings` 要返回**当前值**，不能返回首次加载那份（否则页面拿旧值覆盖新设置）。

**真机验证（USB，本地 mint 服务器，dev client）**：全部下载 11 / 31 / 24 / 216 本入队、单写者逐本下；HOME 后台 → `waiting/background` 不动 → 回前台自动续；`am force-stop` 重启 → 未完成的回排队按游标续传；关 Wi‑Fi → `waiting/network`（attempts 不增）→ 开 Wi‑Fi 自动续；暂停 / 继续 / 置顶（抢占当前并保留其进度）/ 取消下载 / 全部暂停 / 全部继续；删除对话框两种删除；阅读页下载图标（锚点 = 视口顶段）；移动网络询问三选项与「不再询问」（无 SIM，临时强制 cellular 测）；等 Wi‑Fi → 回到 Wi‑Fi 自动开始；下载完成后 `server_id` 回填（同步 likes 成功）。

**下载请求超时**（2026-10-12 补）：每块请求 30 秒超时（`DOWNLOAD_TIMEOUT_MS`），和计时器赛跑而不只靠
`abort`（fetch 被 CopilotKit 的 polyfill 接管）。超时抛 `RequestTimeoutError`，按失败走退避重试，**不**当作
「等待网络」——否则服务器卡住时会无限重试、永远到不了「失败」。真机 release 包把超时临时设为 1 ms 验证：
首次 → 5 s → 30 s → 2 min 共重试 3 次后转「下载失败 · 请求超时」，与设计一致。

**未在真机覆盖**：服务端返回 HTTP 错误时的退避重试（超时路径已真机验证，二者走同一分支）、登录 / 退出切换用户时的 `suspendDownloads`、iOS。

> release 包不可调试：`adb exec-out run-as … cat` 会报 `package not debuggable`，拉不到库（脚本若不检查会读到旧副本）。
> release 下只能看界面与 logcat（`console.warn` 在 release 仍会输出到 `ReactNativeJS`）。

