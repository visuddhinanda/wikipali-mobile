/**
 * WikiPali 网页链接 → App 内路由。
 *
 * 扫码与「其他 App 分享链接给 WikiPali」走的是同一份解析，
 * 新增链接形态只要往 `parseWikipaliUrl` 里加分支即可。
 *
 * 目前认得：
 *   https://next.wikipali.org/library/tipitaka/104-282/read?channel=<uuid>
 *   http://127.0.0.1:8000/library/tipitaka/169-893/read?channel=<uuid>
 *   （自建实例可跑在任意 host / IP / 端口 —— localhost、局域网 IP、自定义域名；
 *     靠 `/library/tipitaka/…` 路径判定，host 不限。语言前缀如 /zh-Hans/library/...
 *     也认；channel 可缺省）
 *   wikipali://library/tipitaka/104-282/read?channel=<uuid>
 */
import { bookEntryAt } from "../catalog";

/** 自定义 scheme（app.json 的 `expo.scheme`）。 */
const SCHEME = "wikipali";

export interface ReaderTarget {
  kind: "reader";
  book: number;
  paragraph: number;
  channelId?: string;
}

export type LinkTarget = ReaderTarget;

interface ParsedUrl {
  /** 已去掉首尾斜杠、按 `/` 切开的路径段。 */
  segments: string[];
  query: Record<string, string>;
}

/**
 * 手工解析 URL：RN 的 `URL` 实现对自定义 scheme 不可靠。
 * 不锚定行首 —— 分享过来的文本常常是「一句话 + 链接」。
 */
function splitUrl(raw: string): ParsedUrl | null {
  const text = raw.trim();
  const m = /([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/.exec(
    text,
  );
  if (!m) return null;
  const [, scheme, host, path = "", search = ""] = m;

  const lowerScheme = scheme.toLowerCase();
  // 只认 http(s) 与自定义 scheme；host 不限 —— 自建实例可能跑在
  // localhost / 127.0.0.1 / 局域网 IP / 自定义域名，是否 WikiPali 链接
  // 由下面 `parseWikipaliUrl` 的 `/library/tipitaka/…` 路径结构判定。
  if (
    lowerScheme !== SCHEME &&
    lowerScheme !== "http" &&
    lowerScheme !== "https"
  ) {
    return null;
  }

  // 自定义 scheme 下 host 其实是第一段路径（wikipali://library/...）。
  const head = lowerScheme === SCHEME && host ? [host] : [];
  const segments = [...head, ...path.split("/")]
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);

  const query: Record<string, string> = {};
  for (const pair of search.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const key = idx < 0 ? pair : pair.slice(0, idx);
    const value = idx < 0 ? "" : pair.slice(idx + 1);
    query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, " "));
  }

  return { segments, query };
}

/** `104-282` → `{ book: 104, paragraph: 282 }`。 */
function parseCoordinate(seg: string): { book: number; paragraph: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(seg);
  if (!m) return null;
  return { book: Number(m[1]), paragraph: Number(m[2]) };
}

/**
 * 解析一条 WikiPali 链接；认不出来返回 `null`（调用方负责提示用户）。
 */
export function parseWikipaliUrl(raw: string): LinkTarget | null {
  const parsed = splitUrl(raw);
  if (!parsed) return null;

  const { segments, query } = parsed;
  // 站点可能带语言前缀（/zh-Hans/library/...），从 `library` 开始看。
  const start = segments.indexOf("library");
  if (start < 0) return null;
  const rest = segments.slice(start + 1);

  // library/<collection>/<book>-<para>/read
  if (rest.length >= 2) {
    const coord = parseCoordinate(rest[1]);
    if (coord) {
      // channel 可能是 `a,b` 多频道（对读），取第一个作为主频道。
      const channel = (query.channel ?? query.channels ?? "").split(",")[0];
      return {
        kind: "reader",
        ...coord,
        channelId: channel || undefined,
      };
    }
  }

  return null;
}

/** 目标对应的阅读器路由参数。 */
export function readerRouteParams(target: ReaderTarget) {
  const entry = bookEntryAt(target.book, target.paragraph);
  return {
    book: target.book,
    paragraph: target.paragraph,
    title: entry?.title ?? String(target.book),
    channelId: target.channelId,
  };
}

/**
 * 从 API base URL 推出网页根地址。
 * `https://next.wikipali.org/api/v2` → `https://next.wikipali.org`；
 * `http://127.0.0.1:8000/api/v2` → `http://127.0.0.1:8000`。
 */
export function webOriginFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v\d+\/?$/, "").replace(/\/+$/, "");
}

/**
 * 生成一条可分享 / 复制的 WikiPali 网页链接。
 * `origin` 取 `webOriginFromBaseUrl(await resolveBaseUrl())`，
 * 即「域名按照用户设置」—— 官方域名或自建实例的 host 都由设置决定。
 */
export function buildWikipaliUrl(origin: string, target: ReaderTarget): string {
  const qs = target.channelId
    ? `?channel=${encodeURIComponent(target.channelId)}`
    : "";
  return `${origin}/library/tipitaka/${target.book}-${target.paragraph}/read${qs}`;
}
