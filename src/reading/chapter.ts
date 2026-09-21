/**
 * 取数用的「章节」——`tipitaka-read-chapter` 的 `para` 参数。
 *
 * 接口按章节取数：`para` 是章节的起始段号，章节长度取那一行的 `chapter_len`。
 * 本地 `pali_text` 里 `parent = -1` 的**顶层行**正好是最粗的一层：
 * 全库 217 本校验过，每本的顶层行首尾相接、**不重不漏地平铺整本书**
 * （每本 1–8 行，最长的一章 15943 段）。
 *
 * 为什么取最粗的一层而不是末层章节：接口每次调用都要在整个章节范围里数一遍
 * 「该 channel 有多少段有译文」（进度条的分母），章节越碎调用次数越多；
 * 顶层一本书最多 8 章，续传游标在章内一路推进，请求数由内容量决定而不是由
 * 目录结构决定。
 */
import type { SqlRunner } from "../catalog/commentary";

/** 一个取数章节的段落闭区间。 */
export interface ApiChapter {
  /** 章节起始段号，即接口的 `para` 参数。 */
  start: number;
  /** 章节结束段号（含）= `start + chapter_len - 1`。 */
  end: number;
}

const cache = new Map<number, Promise<ApiChapter[]>>();

/** 清空按书缓存的章节表（切换数据库或测试时用）。 */
export function clearApiChapterCache(): void {
  cache.clear();
}

/** 一本书的取数章节（按 `start` 升序，首尾相接覆盖全书）。 */
export function bookApiChapters(
  sql: SqlRunner,
  book: number,
): Promise<ApiChapter[]> {
  let p = cache.get(book);
  if (!p) {
    p = (async () => {
      const rows = await sql.all<{ paragraph: number; chapter_len: number | null }>(
        `SELECT paragraph, chapter_len FROM pali_text
          WHERE book = ? AND parent = -1 ORDER BY paragraph`,
        [book],
      );
      return rows.map((r) => ({
        start: r.paragraph,
        // 正文行的 chapter_len 恒为 1；脏数据保底也按 1 段算，避免区间倒挂
        end: r.paragraph + Math.max(1, r.chapter_len ?? 1) - 1,
      }));
    })().catch((err) => {
      cache.delete(book); // 失败不缓存，下次重试
      throw err;
    });
    cache.set(book, p);
  }
  return p;
}

/** 包含段落 `para` 的取数章节；`para` 超出本书范围返回 null。 */
export async function apiChapterAt(
  sql: SqlRunner,
  book: number,
  para: number,
): Promise<ApiChapter | null> {
  const chapters = await bookApiChapters(sql, book);
  let lo = 0;
  let hi = chapters.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chapters[mid];
    if (para < c.start) hi = mid - 1;
    else if (para > c.end) lo = mid + 1;
    else return c;
  }
  return null;
}
