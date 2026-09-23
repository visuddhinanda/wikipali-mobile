/**
 * 巴利书名的 i18n 查找（数据在 `i18n/<locale>/books.ts`）。
 *
 * 书名是「兜底」：某个频道（channel）自己译出了 level=1 标题时用频道的译文，
 * 没有才回到这里按界面语言取译名（`book.title.<book>-<para>`）。
 *
 * 每种语言各一个文件、各自本地化；**i18n 文件里只放该语言的译名，不放巴利名**。
 * 某语言还没译时这里返回 `undefined`，由调用方（`src/reading/bookTitle.ts`）
 * 继续回退到本地目录库的巴利 `toc`。
 */
import type { Locale } from "./index";
import zhHans from "./zh-Hans/books";
import zhHant from "./zh-Hant/books";
import en from "./en/books";
import type {
  BookTitleMessageKey,
  BookTitleMessages,
} from "./zh-Hans/books";

/** 已本地化的书名目录；其余语种补译后在这里登记。 */
const CATALOGS: Partial<Record<Locale, BookTitleMessages>> = {
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  en,
};

function lookup(locale: Locale, key: string): string | undefined {
  const catalog = CATALOGS[locale];
  if (!catalog) return undefined;
  return key in catalog ? catalog[key as BookTitleMessageKey] : undefined;
}

/** 实际书名的 key：`book.title.<book>-<para>`。 */
export function bookTitleKey(book: number, para: number): string {
  return `book.title.${book}-${para}`;
}

/** 实际书名（level=1）：按界面语言取译名；没有返回 undefined。 */
export function bookTitleText(
  locale: Locale,
  book: number,
  para: number,
): string | undefined {
  return lookup(locale, bookTitleKey(book, para));
}

/** 丛书名：按界面语言取译名；没有返回 undefined。 */
export function bookSeriesText(
  locale: Locale,
  name: string,
): string | undefined {
  return lookup(locale, name);
}
