# API Schema 契约与 OpenAPI 注解完善清单

> 定位：移动端 `src/api` 与后端（mint api-v13）之间的**接口契约**。
> 本文档记录：① 契约文件与工作流；② 类型化客户端；③ 服务端 OpenAPI 注解需补齐的清单。

---

## 1. 契约文件与工作流

- **契约文件**：`src/api/schema.d.ts`，由后端 OpenAPI 注解经 `openapi-typescript`（v7 输出格式）生成。
- **工作流**：后端 API 有改动 → 重新生成 schema → 覆盖 `src/api/schema.d.ts`。
  移动端不再靠口头/文字同步接口变化，schema 就是唯一真源。
- **版本对齐**：`openapi-fetch` `^0.17.0`（与 dashboard-v6 相同）；生成工具保持 `openapi-typescript` v7，
  保证 `paths` 形状与 `openapi-fetch` 0.17 兼容。
- **注意**：这是声明文件（`.d.ts`），只用于编译期类型检查，不参与运行；Metro 打包时会被剥离。

## 2. 类型化客户端

- 文件：`src/api/openapi-client.ts`。
- 用法：`const client = await getApiClient(); await client.GET("/v2/book-title", { params: {...} });`
- baseUrl 为 `/api` 根（`config.ts` 的 `resolveApiRoot()`），与 dashboard-v6 的 `baseUrl: "/api"` 对齐；
  schema 里的 `/v2/...`、`/v3/...` 路径直接拼成完整 URL。
- 现有手写 `request<T>`（`src/api/client.ts`）暂时保留，等下方清单补齐、schema 重新生成后逐文件迁移。

---

## 3. 服务端 OpenAPI 注解需补齐清单

> 现状：v2 接口的响应 `data` / `data.rows` 大量是 `Record<string, never>`（空对象），
> 逐字段类型等于没有；v3 接口部分已类型化。下面只列移动端实际消费、且类型不足/有误的接口，
> 按影响优先级排序。

### A. 响应 item 完全无类型（`data`/`rows` = 空对象）—— 移动端核心链路，最优先

| # | 接口 | 现状 | 需补的 item schema（对齐移动端现有类型） |
|---|---|---|---|
| 1 | `GET /v2/book-title` | `data.rows = Record<string,never>[]` | `BookTitle`：`book:int`、`paragraph:int`、`sn`、`title`、`toc`、`tags[]`、`related_name`、`language` |
| 2 | `GET /v2/chapter?view=toc` | `data.rows = Record<string,never>[]` | `TocItem`：`book:int`、`paragraph:int`、`pali_title`、`title`、`level` |
| 3 | `GET /v2/progress`（多 view） | `data.rows = Record<string,never>[]` | 按 view 分 schema（至少这三个）：`view=chapter_channels` → `{book, para, uid, channel_id, name, type, progress, updated_at, channel{uid,name,type}}`；`view=ids` → `{id}`；`view=channel`（+`channel_type=translation`）→ `{channel_id, count, studio{...}, channel{name,summary,lang}}` |
| 4 | `GET /v2/channel/{channel}` | `data = Record<string,never>` | `ChannelInfo`：`uid`、`name`、`summary`、`lang`、`type`、`updated_at`、`studio{id,nickName,realName,studioName,avatar}` |
| 5 | `GET /v2/progress/{progress}` | `data = Record<string,never>` | `ProgressChapterInfo`：`book:int`、`para:int`、`channel_id`、`title` |
| 6 | `GET /v2/auth/current` | `data = Record<string,never>` | `AuthUser`：`id`、`nickName`、`realName`、`avatar`、`roles[]`（可复用 `/v3/me/reactions` 里已类型化的 `user` 结构） |
| 7 | `POST /v2/sign-in` | response `data = Record<string,never>` | `data` 为 token（`string`） |

### B. 字段类型错误（会污染类型，照抄会改错移动端已有正确类型）

| # | 接口 | 问题 | 应改为 |
|---|---|---|---|
| 8 | `GET/POST /v2/recent` | `id` / `type` / `article_id` 标成 `number` | 三者都是 `string`（`article_id` 形如 `"<book>-<para>"`） |
| 9 | `GET /v2/recent` | 查询参数缺 `view` | 补 `view?: "user" | ...`（移动端用 `view=user` 拉某用户记录） |

### C. v3 阅读链路（已随端点合并重做）

旧的 `GET /v3/tipitaka-read-chapter` 与 `GET /v3/tipitaka-read-para` 已合并为
`GET /v3/tipitaka-reading/{channel}`，并补齐了类型（`data[] = {para, display, book}`、
`meta = {page_size, page_size_unit, next_cursor, total, remaining}`），原清单 #10/#11
随之关闭。

### D. 已达标（无需改，供核对）

- `GET /v3/progress`：`data[]` 已逐字段类型化（`book/para/lang/progress/channel_id/title/last_chapter_completed_at/completed_at/updated_at`），对齐移动端 `ChannelBook`（`view` 参数已删，channel 是唯一口径）。✅
- `GET/POST/DELETE /v3/me/reactions`：`data` / `requestBody` 已类型化（含 `type`/`target_type` 枚举、`user` 嵌套）；POST 返回完整 reaction 资源、DELETE 返回 204。✅

---

## 4. 根因提示

v2 接口普遍返回 `data?: Record<string, never>`，根因是 **v2 控制器响应未写 item 的 OpenAPI schema**（不止上面列出的 9 个）。
移动端目前只消费上述接口；若后续新增 v2 调用，应同样要求补齐对应响应注解。
