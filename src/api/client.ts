/** 极简 fetch 封装：超时 + JSON 解析 + 统一错误。 */
import { t } from "../i18n";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /**
     * 错误响应的 JSON 正文（解析失败则为 undefined）。
     *
     * 4xx 的正文里有服务端的判定理由，调用方据此区分「参数写错了」与
     * 「这是一个正常的业务边界」—— 章节接口的 422 `errors.from` 就是后者：
     * 游标之后没有译文了，是取数的终点而不是 bug（见 `read-chapter.ts`）。
     */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  // 超时必须覆盖到「读完 body」为止：只包住 fetch 的话，服务端发完响应头
  // 就卡住时 `res.text()` 会永久挂起 —— 整本下载就是这样卡死在某一批，
  // 循环再也回不到 `flag.cancelled` 检查点，`running` 标记不释放，
  // 之后点「继续」全是空操作（要杀进程才能恢复）。
  let res: Response;
  let text: string;
  try {
    res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      // 错误正文要读出来：v3 的 422/404 把判定理由放在 body 里，
      // 只回一个状态码的话调用方无法区分业务边界与参数错误。
      let body: unknown;
      try {
        body = JSON.parse(await res.text());
      } catch {
        body = undefined;
      }
      throw new ApiError(`HTTP ${res.status}`, res.status, body);
    }

    text = await res.text();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      err instanceof Error ? err.message : t("error.network"),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(t("error.badJson"));
  }
}
