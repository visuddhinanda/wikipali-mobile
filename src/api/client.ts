/** 统一 API 错误。 */
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
