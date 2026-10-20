/**
 * 百科词条（dhamma term）接口客户端。
 *
 * 阅读正文里的 `.term-ref`（如「沙瓦提」）点开后按 guid 查词条释义：
 * 手机用底部抽屉、平板用 popover 展示（见 `src/components/TermSheet.tsx`）；
 * 抽屉/popover 里的「阅读条目」再跳到完整词条页（`src/screens/TermEntryScreen.tsx`），
 * 该页用接口返回的 `html` 字段渲染正文。
 *
 * 后端：mint `DhammaTermController@show`（`/v2/terms/{guid}`，公开接口）。
 */
import { getApiClient, throwHttpError, unwrapV2 } from "./openapi-client";
import { t } from "../i18n";

/** 词条作者信息（接口里是对象，schema 里宽松地标成了 string）。 */
export interface TermPerson {
  nickName?: string;
  realName?: string;
  studioName?: string;
}

export interface TermEntry {
  /** 巴利原词，如 sāvatthī。 */
  word: string;
  /** 释义，如「沙瓦提」。 */
  meaning: string;
  /** 词条摘要（note / community summary），抽屉/popover 用。 */
  summary: string;
  /** 词条完整正文 HTML，词条详情页用。 */
  html: string;
  language?: string;
  note?: string;
  editor?: TermPerson;
  studio?: TermPerson;
  created_at?: string;
  updated_at?: string;
}

/** 按 guid 取一条词条；查不到 / 网络失败都会抛错。 */
export async function fetchTerm(guid: string): Promise<TermEntry> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/terms/{term}", {
    params: { path: { term: guid } },
  });
  if (error) throwHttpError(error, response);
  const d = unwrapV2<{
    word?: string;
    meaning?: string;
    summary?: string;
    html?: string;
    language?: string;
    note?: string;
    editor?: unknown;
    studio?: unknown;
    created_at?: string;
    updated_at?: string;
  }>(data, t("error.backend"));
  return {
    word: d.word ?? "",
    meaning: d.meaning ?? "",
    summary: d.summary ?? "",
    html: d.html ?? "",
    language: d.language,
    note: d.note,
    editor: (d.editor ?? {}) as TermPerson,
    studio: (d.studio ?? {}) as TermPerson,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}
