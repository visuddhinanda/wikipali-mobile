/**
 * 当前用户自己的 reactions（点赞/收藏/书签/关注/下载记录）接口客户端。
 *
 * 对应 mint `MeReactionV3Controller`（`/api/v3/me/reactions`），**取代旧的
 * v2 `LikeController`（`/api/v2/like`）**：
 *
 *   GET    /api/v3/me/reactions             列出我的 reactions（type/target_type 过滤 + 分页）
 *   POST   /api/v3/me/reactions             幂等添加，唯一键 (type, target_id, user_id)
 *   DELETE /api/v3/me/reactions/{id}        删除我自己的 reaction
 *
 * 底层表仍是 `likes`（Reaction 模型 `$table='likes'`），type 区分
 * favorite/bookmark/download。唯一键是 `(type, target_id, user_id)`（不是 id）。
 * 契约与数据映射见 `docs/multi-user-sync.md` §6.2 / §7.1。
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { request } from "./client";
import { authHeaders } from "./auth";
import { metaInt } from "./v3";
import { t } from "../i18n";

/** v3 单个资源信封：`{ data: {...} }`（`*V3Resource` 单数响应）。 */
interface V3Data<T> {
  data: T;
}

/** `store` / `destroy` 返回的 `ReactionStatusV3Resource` 形状。 */
interface ReactionStatus {
  type: string;
  count: number;
  selected: boolean;
  id: string | null;
}

/** v2 信封（`progress?view=ids` 仍是 v2 的 ProgressChapterController）。 */
interface Envelope<T> {
  ok: boolean;
  data: T;
  message?: string;
}

/** 新增 / 更新一条 reaction（幂等）。返回服务器记录 id（用于回填与删除）。 */
export async function likeUpsert(params: {
  type: string;
  target_id: string;
  target_type: string;
  context?: string;
}): Promise<{ id: string }> {
  const base = toApiV3Base(await resolveBaseUrl());
  const raw = await request<V3Data<ReactionStatus>>(`${base}/me/reactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...authHeaders(),
    },
    body: JSON.stringify(params),
  });
  const status = raw.data;
  if (!status?.id) {
    throw new Error(t("error.backend"));
  }
  return { id: status.id };
}

/** 删除一条 reaction（`DELETE /me/reactions/{id}`，只能删自己）。 */
export async function likeDelete(id: string): Promise<void> {
  const base = toApiV3Base(await resolveBaseUrl());
  await request<unknown>(`${base}/me/reactions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
}

/**
 * 把客户端 (book, para, channel) 解析成服务器 `progress_chapters.uid`
 * （`progress?view=ids`，仍是 v2 的 `ProgressChapterController`）。
 * 找不到（该版本没有这个章节的译文）返回 null。
 */
export async function resolveProgressChapterUid(
  book: number,
  para: number,
  channelId: string,
): Promise<string | null> {
  const base = await resolveBaseUrl();
  const env = await request<Envelope<{ rows: { id: string }[]; count: number }>>(
    `${base}/progress?view=ids&book=${book}&par=${para}&channel=${encodeURIComponent(channelId)}`,
  );
  if (!env || env.ok === false) {
    throw new Error(env?.message ?? t("error.backend"));
  }
  return env.data.rows[0]?.id ?? null;
}

/** 反查一个 progress_chapter：`uid → { book, para, channel_id }`。 */
export interface ProgressChapterInfo {
  book: number;
  para: number;
  channel_id: string;
  title?: string | null;
}

/**
 * 按 `progress_chapters.uid` 反查章节（`GET /api/v2/progress/{uid}`，
 * `ProgressChapterController::show`，路由绑定用模型主键 `uid`）。
 * 用于把拉回的 reaction `target_id` 还原成客户端 (book, para, channel)。
 */
export async function fetchProgressChapter(
  uid: string,
): Promise<ProgressChapterInfo> {
  const base = await resolveBaseUrl();
  const env = await request<Envelope<ProgressChapterInfo>>(
    `${base}/progress/${encodeURIComponent(uid)}`,
    { headers: { ...authHeaders() } },
  );
  if (!env || env.ok === false) {
    throw new Error(env?.message ?? t("error.backend"));
  }
  return env.data;
}

/** 我的一条 reaction（`ReactionV3Resource` 核心字段）。 */
export interface MyReaction {
  id: string;
  type: string;
  target_id: string;
  target_type: string;
  context: string | null;
  updated_at?: string;
}

/**
 * 分页拉取我自己的 reactions（`GET /api/v3/me/reactions`）。
 * `type` 传 favorite/bookmark/download 等，`targetType` 固定 progress_chapter。
 */
export async function listMyReactions(
  type: string,
  targetType = "progress_chapter",
): Promise<MyReaction[]> {
  const base = toApiV3Base(await resolveBaseUrl());
  const perPage = 100;
  const rows: MyReaction[] = [];
  let page = 1;
  let total = Infinity;
  const MAX_PAGES = 50;
  while (page <= MAX_PAGES && rows.length < total) {
    const raw = await request<{ data: MyReaction[]; meta: Record<string, unknown> }>(
      `${base}/me/reactions?type=${encodeURIComponent(type)}` +
        `&target_type=${encodeURIComponent(targetType)}&page=${page}&per_page=${perPage}`,
      { headers: { ...authHeaders() } },
    );
    const items = Array.isArray(raw.data) ? raw.data : [];
    rows.push(...items);
    if (items.length === 0) break;
    const reported = metaInt(raw.meta, "total");
    total = reported ?? (items.length < perPage ? rows.length : Infinity);
    page += 1;
  }
  return rows;
}
