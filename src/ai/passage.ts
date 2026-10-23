/**
 * 阅读页提问交给 agent 的段落上下文（AG-UI state 里的 `passage`）。
 *
 * 字段与后端约定一致，见 agent-poc 仓库 docs/agent-routing.md §3：
 * - `selection`：选中文字提问——`paragraphs` 是选区覆盖的段，`focus` 是选区起始段，
 *   后端会再取前后各一段作上下文；
 * - `screen`：点按提问按钮——`paragraphs` 是屏幕上可见的段，`focus` 是视口顶部段。
 * 两种都会让后端取段落原文 + 所选版本译文 + 所在章节 + 重点段的义注 / 复注。
 */
export interface AskPassage {
  source: "selection" | "screen";
  book: number;
  paragraphs: number[];
  focus: number;
  /** 读者正在看的版本 uid（可空：没选版本时只看巴利原文）。 */
  channel?: string;
  /** 选中的文字（罗马巴利），仅 selection。 */
  selected_text?: string;
  /** 章节标题，仅展示用。 */
  title?: string;
}

/** 段号去重、排序，过滤掉非正整数（WebView 回传的是字符串属性）。 */
export function cleanParas(values: unknown[]): number[] {
  const out = new Set<number>();
  for (const v of values) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
