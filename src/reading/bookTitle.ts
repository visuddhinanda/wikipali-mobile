/**
 * 书名的最终展示（书名卡片的兜底链）。
 *
 * 一本书在某个频道下的展示名按优先级取：
 *   1. 频道自己译出的 level=1 标题（`para_html` 里该频道该段的译文）；
 *   2. i18n 译名（`book.title.<book>-<para>`，见 `src/i18n/<locale>/books.ts`）；
 *   3. 服务端给的标题（常为空串）；
 *   4. 本地目录库的巴利 `toc`；
 *   5. 书的编号。
 *
 * 频道没译 level=1 标题（或正文还没缓存下来）时，就降级到 i18n。
 */
import { bookEntryAt } from "../catalog";
import { bookTitleText } from "../i18n/bookTitles";
import type { Locale } from "../i18n";
import { channelHeadingTextsByBook } from "./heading";

export interface BookTitleRef {
  book: number;
  /** 段落号（任意段都可，内部向上定位到 level=1）。 */
  para?: number;
  /** 服务端给的标题，常为空串，作为 i18n 之后的兜底。 */
  serverTitle?: string;
}

/**
 * 一次解析一批书的展示名（一个频道下）。
 *
 * 返回 `Map<book, 展示名>`。频道无 level=1 译文时会落到 i18n，所以 UI 语言
 * 切换后需要重新调用一次。
 */
export async function resolveBookTitles(
  locale: Locale,
  channelId: string,
  books: BookTitleRef[],
): Promise<Map<number, string>> {
  const refs = books.map((b) => {
    const entry = bookEntryAt(b.book, b.para);
    return {
      book: b.book,
      level1Para: entry?.paragraph ?? b.para,
      toc: entry?.toc,
      serverTitle: (b.serverTitle ?? "").trim() || undefined,
    };
  });

  const channelTitles = await channelHeadingTextsByBook(
    channelId,
    refs
      .filter((r) => r.level1Para != null)
      .map((r) => ({ book: r.book, para: r.level1Para! })),
  );

  const out = new Map<number, string>();
  for (const r of refs) {
    const title =
      (r.level1Para != null ? channelTitles.get(r.book) : undefined) ??
      (r.level1Para != null
        ? bookTitleText(locale, r.book, r.level1Para)
        : undefined) ??
      r.serverTitle ??
      r.toc ??
      String(r.book);
    out.set(r.book, title);
  }
  return out;
}
