/**
 * 章节标题的译文。
 *
 * 目录库 `pali_text.toc` 里的标题是**巴利文**，所有语种的用户看到的都是它。
 * 但标题行本身也是一个段落，译者译了正文通常也把标题译了 —— 那段译文就躺在
 * `para_html` 里（章节接口对标题行同样返回 `display`，见
 * `docs/reading-content.md` §2）。
 *
 * 所以：**该版本译出了标题段就用它，没译才退回巴利 `toc`**。逐条回退，不是
 * 整本二选一 —— 残缺译本常常只译了前几章的标题。
 */
import { openReadingDb } from "./db";

/**
 * 单条 `IN (...)` 的占位符上限。SQLite 默认最多 999 个变量，这里留出
 * channel / book 两个。标题行最多的一本书有 2407 行，也就三条语句。
 */
const SQL_IN_CHUNK = 900;

/**
 * 段落 HTML → 纯文本（标题栏、目录项都是纯文本控件，塞不进标签）。
 *
 * 实体解码放在去标签之后、且 `&amp;` 放最后：先解码会把 `&lt;div&gt;`
 * 变成真标签再被剥掉，顺序反了会吃掉正文。
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 这些标题段里，该版本译出了正文的那些：段落号 → 标题文本。
 *
 * 没译的段不出现在结果里（空段占位的 `html IS NULL` 同样被滤掉），调用方据此
 * 退回巴利 `toc`。
 */
export async function channelHeadingTexts(
  channelId: string,
  book: number,
  paras: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!channelId || paras.length === 0) return out;

  const db = await openReadingDb();
  for (let i = 0; i < paras.length; i += SQL_IN_CHUNK) {
    const chunk = paras.slice(i, i + SQL_IN_CHUNK);
    const rows = await db.getAllAsync<{ para: number; html: string }>(
      `SELECT para, html FROM para_html
        WHERE channel = ? AND book = ? AND html IS NOT NULL
          AND para IN (${chunk.map(() => "?").join(",")})`,
      [channelId, book, ...chunk],
    );
    for (const r of rows) {
      const text = htmlToText(r.html);
      if (text) out.set(r.para, text);
    }
  }
  return out;
}

/**
 * 一批 (book, para) 里频道译出的标题文本，book → 文本。
 *
 * 与 `channelHeadingTexts` 的区别是跨多本书一次查，供频道书列表的书名卡片用。
 * 传入的 (book, para) 通常就是每本书的 level=1 段。
 */
export async function channelHeadingTextsByBook(
  channelId: string,
  refs: { book: number; para: number }[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!channelId || refs.length === 0) return out;

  const db = await openReadingDb();
  // 每个 (book, para) 占 2 个占位符；留余量给 SQLite 999 变量上限。
  const CHUNK = 450;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const conds = chunk.map(() => "(book = ? AND para = ?)").join(" OR ");
    const params: (string | number)[] = [channelId];
    for (const r of chunk) params.push(r.book, r.para);
    const rows = await db.getAllAsync<{
      book: number;
      para: number;
      html: string;
    }>(
      `SELECT book, para, html FROM para_html
        WHERE channel = ? AND html IS NOT NULL AND (${conds})`,
      params,
    );
    for (const r of rows) {
      const text = htmlToText(r.html);
      if (text) out.set(r.book, text);
    }
  }
  return out;
}
