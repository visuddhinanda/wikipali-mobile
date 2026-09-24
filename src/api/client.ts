/** 统一 API 错误。 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /**
     * 错误响应的 JSON 正文（解析失败则为 undefined）。
     *
     * 4xx 的正文里有服务端的判定理由，调用方据此区分「参数写错了」与
     * 「这是一个正常的业务边界」。
     */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
