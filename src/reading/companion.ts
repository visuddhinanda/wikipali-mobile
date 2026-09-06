/**
 * 义注复注对读：给定原文的章节锚点，算出义注、复注的对应章节坐标。
 *
 * 只算坐标，不取正文 —— 加载正文是阅读器在用户真正滑到那一页时才做的事
 * （见 `docs/reading-content.md`）。严格按层级链路取：没有义注就不找复注，
 * 不允许原文直接跳复注（`docs/commentary-layers.md`）。
 */
import { findRelatedChapters } from "../catalog/commentary";
import { tipitakaRunner } from "./db";

export interface CompanionChapter {
  book: number;
  paragraph: number;
  toc: string | null;
}

export interface CompanionLayers {
  atthakatha: CompanionChapter | null;
  tika: CompanionChapter | null;
}

function pick(r: { book: number; paragraph: number; toc: string | null } | undefined): CompanionChapter | null {
  return r ? { book: r.book, paragraph: r.paragraph, toc: r.toc } : null;
}

export async function getCompanionLayers(
  book: number,
  paragraph: number,
): Promise<CompanionLayers> {
  const related = await findRelatedChapters(await tipitakaRunner(), book, paragraph);
  const atthakatha = related.find((r) => r.layer === "atthakatha");
  const tika = atthakatha ? related.find((r) => r.layer === "tika") : undefined;
  return { atthakatha: pick(atthakatha), tika: pick(tika) };
}
