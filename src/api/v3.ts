/**
 * v3 列表响应的拆包。
 *
 * 同一个控制器在两种外层信封下都出现过，客户端两种都要认：
 *
 * - **新契约**（`mint/api-v13` 现在的 v3）：Laravel 资源集合原样输出，
 *   `{ data: [...], meta: {...} }`；错误走 RFC 9457 Problem Details。
 * - **旧信封**（线上 next/www 仍在跑的版本）：`{ ok, data: { items, pagination }, message }`。
 *
 * 两者的差别只在外层，逐项的形状一致，所以这里只负责把 `items` 与 `meta`
 * 挑出来，键名语义交给各接口自己校验 —— 拿不到期望的键就当契约不符报错，
 * 而不是静默当成空结果（那会被缓存层写成「确认无内容」）。
 */
import { ApiError } from "./client";
import { t } from "../i18n";

export interface V3Collection<T> {
  items: T[];
  meta: Record<string, unknown>;
}

export function unwrapV3Collection<T>(raw: unknown): V3Collection<T> {
  const env = raw as
    | {
        ok?: boolean;
        message?: string;
        data?: unknown;
        meta?: unknown;
        items?: unknown;
        pagination?: unknown;
      }
    | null
    | undefined;
  if (!env) throw new ApiError(t("error.backend"));
  if (env.ok === false) throw new ApiError(env.message || t("error.backend"));

  // 旧信封把真正的载荷包在 data 里；新契约的 data 就是条目数组本身。
  const body =
    env.ok === true && env.data && !Array.isArray(env.data)
      ? (env.data as { items?: unknown; pagination?: unknown; meta?: unknown })
      : env;

  const list = Array.isArray(body.items)
    ? body.items
    : Array.isArray((body as { data?: unknown }).data)
      ? ((body as { data?: unknown }).data as unknown[])
      : null;
  if (!list) throw new ApiError(t("error.backend"));

  const meta = (body.pagination ?? body.meta ?? {}) as Record<string, unknown>;
  return { items: list as T[], meta };
}

/** 取 meta 里的整数字段；缺失或不是数字返回 undefined。 */
export function metaInt(
  meta: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}
