/**
 * 讨论（discussion）接口客户端：目前只用来读阅读页 issue 与译文评估标注的内容。
 *
 * 阅读正文里的标注由服务端注入（mint `PaliContentService::injectAnnotationNotes`）：
 * 有位置的 issue 是 `span.anno-issue`（高亮原文），没有位置的是句尾 `span.anno-issue-mark`
 * （三角叹号）；译文评估（assessment）是句尾 `span.anno-assessment-mark`（对勾，按分数着色），
 * 都带 `data-discussion-ids`。点开后按 id 逐条取内容，
 * 手机抽屉 / 平板 popover 展示（见 `src/components/IssueSheet.tsx`）。
 *
 * 后端：mint `V3\DiscussionController@show`（`GET /v3/discussions/{discussion}`，
 * issue 与评估对匿名公开）。
 */
import { getApiClient, throwHttpError } from "./openapi-client";
import { ApiError } from "./client";
import { t } from "../i18n";
import type { paths } from "./schema";

type DiscussionData = NonNullable<
  paths["/v3/discussions/{discussion}"]["get"]["responses"][200]["content"]["application/json"]["data"]
>;

export type IssueSeverity = "error" | "warning" | "suggestion";

export interface Issue {
  id: string;
  /** 讨论类型：issue，或译文评估 assessment。 */
  type: string;
  title: string;
  /** 服务端渲染好的纯文本正文（模板已展开）。评估的正文是打分理由。 */
  summary: string;
  severity: IssueSeverity | null;
  /** 评估分数 0–100（只有 assessment 有）。 */
  score: number | null;
  /** 评估方法（assessment 的 severity 列存的就是它）。 */
  method: string;
  editor: string;
  /** AI 凭人类授权代写时的模型昵称；此时 editor 是授权人。 */
  coEditor: string;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
}

const SEVERITIES: readonly IssueSeverity[] = ["error", "warning", "suggestion"];

function asSeverity(value: unknown): IssueSeverity | null {
  return SEVERITIES.find((s) => s === value) ?? null;
}

/**
 * 按 id 取一条 issue。已删除 / 不存在返回 null；网络失败等其它错误抛出。
 */
export async function fetchIssue(id: string): Promise<Issue | null> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET(
    "/v3/discussions/{discussion}",
    { params: { path: { discussion: id } } },
  );
  if (response.status === 404) return null;
  if (error) throwHttpError(error, response);
  const d: DiscussionData | undefined = data?.data;
  if (!d) throw new ApiError(t("error.backend"));
  const isAssessment = d.type === "assessment";
  return {
    id: d.id ?? id,
    type: d.type ?? "",
    title: d.title ?? "",
    summary: (d.summary ?? d.content ?? "").trim(),
    severity: isAssessment ? null : asSeverity(d.severity),
    score: d.score ?? null,
    method: isAssessment ? (d.severity ?? "") : "",
    editor: d.editor?.nickName ?? "",
    coEditor: d.co_editor?.nickName ?? "",
    createdAt: d.created_at ?? "",
    updatedAt: d.updated_at ?? "",
    replyCount: d.reply_count ?? 0,
  };
}
