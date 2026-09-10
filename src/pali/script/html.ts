/**
 * 对服务端返回的段落 HTML 做字体转换。
 *
 * 只转**确定是巴利原文**的部分，判据是服务端已经给出的标记（见
 * `PaliContentService::renderReadSentences`）：原文 / 逐词频道的段落外壳是
 * `<div class='original' …>`，译文频道是 `class='translation'`。所以这里按
 * class 判断，不靠猜内容，混排的段落也不会误伤译文。
 *
 * ⚠️ nissaya 频道（巴利 + 缅文逐词对照）暂不支持：它在 `format=html` 下
 * 输出的是 `巴利၊缅文` 纯文本拼接，HTML 里没有任何标记可以把巴利那半截认出来。
 * 需要后端在 `NissayaTemplate` 加 html 分支，把巴利包成 `<span class="pali">`；
 * 这里已经把 `pali` 也算作可转换的 class，后端一改，前端不用动。
 */
import { convertScript, type TargetScript } from "./convert";
import type { Niggahita } from "./convert";

/** 可以整块转换的 class：段落外壳的 `original`，以及（将来）nissaya 的 `pali`。 */
const CONVERTIBLE = /\bclass\s*=\s*(?:'|")[^'"]*\b(?:original|pali)\b/i;

/** HTML 实体：整体跳过，不然 `&amp;` 里的字母会被当成巴利转掉。 */
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi;

/** 转换一段纯文本（保留其中的 HTML 实体）。 */
function convertText(
  text: string,
  to: TargetScript,
  niggahita?: Niggahita,
): string {
  let out = "";
  let last = 0;
  ENTITY.lastIndex = 0;
  for (let m = ENTITY.exec(text); m; m = ENTITY.exec(text)) {
    out += convertScript(text.slice(last, m.index), { from: "roman", to, niggahita });
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + convertScript(text.slice(last), { from: "roman", to, niggahita });
}

export interface ConvertHtmlOptions {
  to: TargetScript;
  niggahita?: Niggahita;
}

/**
 * 把段落 HTML 里的巴利原文转成目标字体，标签与属性原样保留。
 *
 * 扫描按标签深度走：进入一个带可转换 class 的元素就开始转，它闭合时停止 ——
 * 嵌套在里面的 `<span>`、`<strong>` 一起转，兄弟的译文块不受影响。
 */
export function convertPaliHtml(html: string, opts: ConvertHtmlOptions): string {
  if (!html || opts.to === "roman") return html;

  let out = "";
  let i = 0;
  let depth = 0;
  /** 开始转换时的深度；`-1` 表示当前不在可转换元素里。 */
  let convertFrom = -1;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += convertFrom >= 0 ? convertText(html.slice(i), opts.to, opts.niggahita) : html.slice(i);
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      out += convertFrom >= 0 ? convertText(text, opts.to, opts.niggahita) : text;
    }
    let gt = html.indexOf(">", lt);
    if (gt < 0) {
      // 标签没闭合：剩下的原样输出，别把半个标签当正文转了
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    out += tag;
    i = gt + 1;

    if (tag[1] === "/") {
      depth = Math.max(0, depth - 1);
      if (convertFrom >= 0 && depth < convertFrom) convertFrom = -1;
    } else if (tag[1] !== "!" && !tag.endsWith("/>")) {
      depth++;
      if (convertFrom < 0 && CONVERTIBLE.test(tag)) convertFrom = depth;
    }
  }

  return out;
}
