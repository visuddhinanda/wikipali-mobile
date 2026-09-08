/**
 * 译本频道（channel）—— wikipali 上按「工作室 + 译本」组织的集合。
 *
 * 一个 channel 下可能有一本或多本书；分类页拿它当推荐位，书架的「批量下载」
 * 拿它当下载单位（选一个译本，把它下的书整批缓存下来）。
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { request } from "./client";
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

/** 频道下的书列表（v3 progress，level=1 即作品粒度）。 */
export async function fetchChannelBooks(uid: string): Promise<ChannelBook[]> {
  const base = toApiV3Base(await resolveBaseUrl());
  const env = await request<Envelope<{ rows: ChannelBook[] }>>(
    `${base}/progress?view=channel&channels=${uid}&level=1`,
  );
  return unwrap(env).rows;
}
