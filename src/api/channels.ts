/**
 * 译本频道（channel）—— wikipali 上按「工作室 + 译本」组织的集合。
 *
 * 一个 channel 下可能有一本或多本书；分类页拿它当推荐位，书架的「批量下载」
 * 拿它当下载单位（选一个译本，把它下的书整批缓存下来）。
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { request } from "./client";
import { metaInt, unwrapV3Collection } from "./v3";
import { t } from "../i18n";

interface Envelope<T> {
  ok: boolean;
  data: T;
  message?: string;
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env || env.ok === false) {
    throw new Error(env?.message ?? t("error.backend"));
  }
  return env.data;
}

/** 频道所属工作室 —— 只取展示要用的几个字段。 */
export interface ChannelStudio {
  id: string;
  nickName?: string;
  realName?: string;
  studioName?: string;
  avatar?: string;
}

/** 频道本体（接口返回的字段远不止这些，只声明用得到的）。 */
export interface ChannelInfo {
  uid: string;
  name: string;
  summary?: string | null;
  lang?: string;
  type?: string;
  updated_at?: string;
  studio?: ChannelStudio;
}

/** 频道列表的一行：频道 + 工作室 + 已译段数。 */
export interface ChannelSummary {
  id: string;
  name: string;
  summary?: string | null;
  lang?: string;
  count: number;
  studio?: ChannelStudio;
}

/** 工作室显示名：昵称 > 工作室名 > 用户名。 */
export function studioLabel(s?: ChannelStudio): string {
  return s?.nickName || s?.studioName || s?.realName || "";
}

/**
 * 某个语族下的译本频道列表。
 *
 * `lang` 传语族（`zh` / `en` / …），简繁、地区变体由服务端一并归拢 ——
 * 简体用户同样看得到 `zh-Hant` 的频道。
 */
export async function fetchTranslationChannels(
  lang: string,
): Promise<ChannelSummary[]> {
  const base = await resolveBaseUrl();
  const env = await request<
    Envelope<{
      rows: {
        channel_id: string;
        count: number;
        studio?: ChannelStudio;
        channel?: { name?: string; summary?: string | null; lang?: string };
      }[];
    }>
  >(
    `${base}/progress?view=channel&channel_type=translation&lang=${encodeURIComponent(lang)}`,
  );
  return unwrap(env).rows.map((r) => ({
    id: r.channel_id,
    name: r.channel?.name ?? "",
    summary: r.channel?.summary ?? null,
    lang: r.channel?.lang,
    count: r.count,
    studio: r.studio,
  }));
}

/** 频道详情（含工作室头像）。 */
export async function fetchChannel(uid: string): Promise<ChannelInfo> {
  const base = await resolveBaseUrl();
  const env = await request<Envelope<ChannelInfo>>(`${base}/channel/${uid}`);
  return unwrap(env);
}

/** 频道下的一本书（level=1 的作品条目 + 翻译进度）。 */
export interface ChannelBook {
  book: number;
  para: number;
  /** 服务端给的标题，常为空串；空时由调用方用本地书目补。 */
  title?: string;
  /** 0–1 的翻译完成度。 */
  progress: number;
  updated_at?: string;
}

/** 一页的条数。服务端不给页大小时只回 10 条，必须显式翻页。 */
const BOOKS_PAGE_SIZE = 200;

/** 翻页的兜底上限，防止服务端 total 不对时空转。 */
const BOOKS_MAX_PAGES = 50;

/**
 * 频道下的书列表（v3 progress，level=1 即作品粒度）。
 *
 * 接口分页，按 `total` 循环取完整列表。必须带 `order=updated_at`：不指定排序
 * 时服务端的顺序没有稳定 tiebreaker，offset 切片跨页会漂移，实测会漏行 + 重复；
 * 带上它之后各种页大小都是无损的。
 */
export async function fetchChannelBooks(uid: string): Promise<ChannelBook[]> {
  const base = toApiV3Base(await resolveBaseUrl());
  const rows: ChannelBook[] = [];
  const seen = new Set<number>();
  let total = Infinity;

  for (let page = 1; page <= BOOKS_MAX_PAGES && rows.length < total; page += 1) {
    // 翻页参数两套一起传：新契约认 `page` / `per_page`，仍在跑的旧版本认
    // `offset` / `limit`，两者指的是同一页，谁认哪个都对。
    const offset = (page - 1) * BOOKS_PAGE_SIZE;
    const raw = await request<unknown>(
      `${base}/progress?view=channel&channels=${encodeURIComponent(uid)}` +
        `&level=1&order=updated_at&page=${page}&per_page=${BOOKS_PAGE_SIZE}` +
        `&offset=${offset}&limit=${BOOKS_PAGE_SIZE}`,
    );
    const { items, meta } = unwrapV3Collection<ChannelBook>(raw);
    // 服务端忽略翻页参数时每页回的是同一批，只靠 total 会空转 50 轮 ——
    // 这一页一本新书都没有就收工。
    const fresh = items.filter((r) => !seen.has(r.book));
    if (fresh.length === 0) break;
    for (const r of fresh) seen.add(r.book);
    rows.push(...fresh);
    // total 缺失时退化成「取到不满一页就结束」。
    const reported = metaInt(meta, "total");
    total =
      reported ?? (items.length < BOOKS_PAGE_SIZE ? rows.length : Infinity);
  }

  return rows;
}
