/**
 * 字符映射表的逐条替换。
 *
 * 表是**有顺序、可链式**的：以锡兰文为例，辅音规则先产出带virama 的形式
 * （`n` → `න්`），后面的规则再拿 virama 和紧跟的罗马元音合并（`්a` → ``），
 * 也就是说后一条规则要看到前一条的输出。所以只能顺序替换，不能编译成
 * 前缀树做单遍最长匹配 —— 那样 `Nigamana` 会变成 `න්ඉග්අම්අන්අ` 而不是 `නිගමන`。
 *
 * 性能上不用担心：表里的键都是字面量（`scripts/gen-script-tables.mjs` 校验过
 * 没有正则元字符），用 `split/join` 而不是 `new RegExp(key,'g')`，省掉每次调用
 * 都要重新编译正则。实测最大的一张表（天城体系 2261 条）转 5000 字符 ≈ 1.9 ms，
 * 一个阅读单元的量级绰绰有余。
 */
import type { CharMap } from "./types";

/** 按映射表顺序替换整段文本。 */
export function applyMap(text: string, map: CharMap): string {
  for (let i = 0; i < map.length; i++) {
    const [key, value] = map[i];
    // split/join 在键不出现时是一次 indexOf，比正则便宜得多
    if (text.indexOf(key) >= 0) text = text.split(key).join(value);
  }
  return text;
}
