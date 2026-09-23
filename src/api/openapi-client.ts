/**
 * 类型化 API 客户端（openapi-fetch），与 Web 端 dashboard-v6 对齐。
 *
 * `schema.d.ts` 由后端 openapi 注解生成（契约文件，见 `docs/api-schema.md`）；
 * 这里的 `createClient<paths>` 把「路径字面量 + HTTP 方法 + 路径参数 + 查询参数」
 * 都纳入编译期检查。baseUrl 用 `/api` 根（对应 schema 里的 `/v2/...`、`/v3/...`），
 * 与 dashboard-v6 的 `baseUrl: "/api"` 同一口径。
 */
import createClient, { type Middleware } from "openapi-fetch";
import { getTokenSync } from "../auth/session";
import { resolveApiRoot } from "./config";
import { ApiError } from "./client";
import type { paths } from "./schema";

/** 每次请求注入 Bearer token，等价于 `src/api/auth.ts` 里 `authHeaders()` 做的事。 */
const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = getTokenSync();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
};

type ApiClient = ReturnType<typeof createClient<paths>>;

/** 按 base 缓存的客户端实例，避免每次调用都重建。 */
const cache = new Map<string, ApiClient>();

/**
 * 取一个绑定到「我 → 设置 → API 服务器」当前地址的类型化客户端。
 * 服务器切换后 base 变化会自动新建实例；同一 base 复用缓存。
 */
export async function getApiClient(): Promise<ApiClient> {
  const baseUrl = await resolveApiRoot();
  let client = cache.get(baseUrl);
  if (!client) {
    client = createClient<paths>({ baseUrl });
    client.use(authMiddleware);
    cache.set(baseUrl, client);
  }
  return client;
}

/**
 * 统一把 openapi-fetch 的 HTTP 错误转成 `ApiError` 抛出。
 * `status` 保留在 ApiError 上，供调用方区分业务边界（如章节接口的 404/422）。
 */
export function throwHttpError(error: unknown, response: Response): never {
  throw new ApiError(`HTTP ${response.status}`, response.status, error);
}

/**
 * v2 接口 200 body 是 `{ ok, data, message }` 信封：检查 `ok` 并取 `data`。
 * `ok:false` / 缺 `data` 都抛 `ApiError`（业务失败），与手写 `request<T>` 行为一致。
 * `env` 用 `unknown`：schema 里 v2 的 `data` 字段多是「全可选」，实际运行时必有，
 * 由调用方用泛型 `T`（如 `RecentRow`）收窄。
 */
export function unwrapV2<T>(env: unknown, fallback: string): T {
  const e = env as { ok?: boolean; data?: T; message?: string } | undefined;
  if (!e || e.ok === false || e.data === undefined) {
    throw new ApiError(e?.message ?? fallback);
  }
  return e.data;
}
