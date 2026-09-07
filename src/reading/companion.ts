/**
 * 义注复注对读：给定原文的章节锚点，算出义注、复注的对应章节坐标。
 *
 * 只算坐标，不取正文 —— 加载正文是阅读器在用户真正滑到那一页时才做的事
 * （见 `docs/reading-content.md`）。严格按层级链路取：没有义注就不找复注，
 * 不允许原文直接跳复注（`docs/commentary-layers.md`）。
 */
import {
  COMMENTARY_LAYERS,
  findRelatedChapters,
  resolveLayer,
  type CommentaryLayer,
} from "../catalog/commentary";
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

/** 对读标签栏的一项：某一层里与当前章节对应的那一章。 */
export interface LayerChapter extends CompanionChapter {
  layer: CommentaryLayer;
}

export interface ChapterLayers {
  /** 传入章节自己所属的层；判不出来时为 `null`。 */
  self: CommentaryLayer | null;
  /** 自己 + 各层对应章节，按 根本→义注→复注→… 排序，每层只留一个。 */
  chapters: LayerChapter[];
  /** `chapters` 里传入章节所在的下标；`self` 未知时为 0。 */
  selfIndex: number;
}

/**
 * 建对读标签栏用的层次列表。
 *
 * 与 `getCompanionLayers` 的区别：那个假定入口一定是根本，只往上找义注、
 * 复注；这个不作假定 —— 从义注进来时根本层往往**没有**对应章节（义注开头
 * 的礼敬偈等在根本里没有出处），此时就不该显示「原文」标签，而应显示
 * 义注（当前）与复注。
 */
export async function getChapterLayers(
  book: number,
  paragraph: number,
): Promise<ChapterLayers> {
  const db = await tipitakaRunner();
  const [selfLayer, related] = await Promise.all([
    resolveLayer(db, book, paragraph),
    findRelatedChapters(db, book, paragraph),
  ]);
  const self = selfLayer?.layer ?? null;

  // 每层只保留一章：同层可能有多部书（如两部复注），取排序后的第一部。
  const byLayer = new Map<CommentaryLayer, LayerChapter>();
  if (self) byLayer.set(self, { layer: self, book, paragraph, toc: null });
  for (const r of related) {
    if (!r.layer || byLayer.has(r.layer)) continue;
    byLayer.set(r.layer, {
      layer: r.layer,
      book: r.book,
      paragraph: r.paragraph,
      toc: r.toc,
    });
  }

  const chapters = [...byLayer.values()].sort(
    (a, b) => COMMENTARY_LAYERS.indexOf(a.layer) - COMMENTARY_LAYERS.indexOf(b.layer),
  );
  const selfIndex = self ? Math.max(0, chapters.findIndex((c) => c.layer === self)) : 0;
  return { self, chapters, selfIndex };
}
