/**
 * 当前用户自己的 reactions（点赞/收藏/书签/关注/下载记录）接口客户端。
 *
 * 对应 mint `MeReactionV3Controller`（`/v3/me/reactions`），**取代旧的
 * v2 `LikeController`（`/v2/like`）**：
 *
 *   GET    /v3/me/reactions             列出我的 reactions（type/target_type 过滤 + 分页）
 *   POST   /v3/me/reactions             幂等添加，唯一键 (type, target_id, user_id)
 *   DELETE /v3/me/reactions/{id}        删除我自己的 reaction
 *
 * 底层表仍是 `likes`（Reaction 模型 `$table='likes'`），type 区分
 * favorite/bookmark/download。唯一键是 `(type, target_id, user_id)`（不是 id）。
 * 契约与数据映射见 `docs/multi-user-sync.md` §6.2 / §7.1。
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError, unwrapV2 } from "./openapi-client";
import { metaInt } from "./v3";
import { t } from "../i18n";

type ReactionType =
  | "like"
  | "dislike"
  | "favorite"
  | "watch"
  | "bookmark"
  | "download";
type ReactionTargetType =
  | "task"
  | "collection"
  | "progress_chapter"
  | "article"
  | "terms";

/** 新增 / 更新一条 reaction（幂等）。返回服务器记录 id（用于回填与删除）。 */
export async function likeUpsert(params: {
  type: string;
  target_id: string;
  target_type: string;
  context?: string;
}): Promise<{ id: string }> {
  const client = await getApiClient();
  const { data, error, response } = await client.POST("/v3/me/reactions", {
    body: params as {
      type: ReactionType;
      target_id: string;
      target_type: ReactionTargetType;
      context?: string;
    },
  });
  if (error) throwHttpError(error, response);
  const id = data?.data?.id;
  if (!id) throw new Error(t("error.backend"));
  return { id };
}

/** 删除一条 reaction（`DELETE /me/reactions/{id}`，只能删自己）。 */
export async function likeDelete(id: string): Promise<void> {
  const client = await getApiClient();
  const { error, response } = await client.DELETE("/v3/me/reactions/{reaction}", {
    params: { path: { reaction: id } },
  });
  if (error) throwHttpError(error, response);
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
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/progress", {
    params: {
      query: {
        view: "ids",
        book: String(book),
        par: String(para),
        channel: channelId,
      },
    },
  });
  if (error) throwHttpError(error, response);
  const env = unwrapV2<{ rows: { id: string }[]; count: number }>(
    data,
    t("error.backend"),
  );
  return env.rows[0]?.id ?? null;
}

/** 反查一个 progress_chapter：`uid → { book, para, channel_id }`。 */
export interface ProgressChapterInfo {
  book: number;
  para: number;
  channel_id: string;
  title?: string | null;
}

/**
 * 按 `progress_chapters.uid` 反查章节（`GET /v2/progress/{uid}`，
 * `ProgressChapterController::show`，路由绑定用模型主键 `uid`）。
 * 用于把拉回的 reaction `target_id` 还原成客户端 (book, para, channel)。
 */
export async function fetchProgressChapter(
  uid: string,
): Promise<ProgressChapterInfo> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/progress/{progress}", {
    params: { path: { progress: uid } },
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<ProgressChapterInfo>(data, t("error.backend"));
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
 * 分页拉取我自己的 reactions（`GET /v3/me/reactions`）。
 * `type` 传 favorite/bookmark/download 等，`targetType` 固定 progress_chapter。
 */
export async function listMyReactions(
  type: string,
  targetType = "progress_chapter",
): Promise<MyReaction[]> {
  const client = await getApiClient();
  const perPage = 100;
  const rows: MyReaction[] = [];
  let page = 1;
  let total = Infinity;
  const MAX_PAGES = 50;
  while (page <= MAX_PAGES && rows.length < total) {
    const { data, error, response } = await client.GET("/v3/me/reactions", {
      params: {
        query: {
          type: type as ReactionType,
          target_type: targetType as ReactionTargetType,
          page,
          per_page: perPage,
        },
      },
    });
    if (error) throwHttpError(error, response);
    const items = (data?.data ?? []) as MyReaction[];
    rows.push(...items);
    if (items.length === 0) break;
    const reported = metaInt(
      (data?.meta ?? {}) as Record<string, unknown>,
      "total",
    );
    total = reported ?? (items.length < perPage ? rows.length : Infinity);
    page += 1;
  }
  return rows;
}
