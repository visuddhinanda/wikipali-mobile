/**
 * 本地 mock 数据层：无后端（EXPO_PUBLIC_API_URL 未配置）时回退到这里，
 * 保证「目录树 → 章节列表 → 阅读器」链路离线可走通。
 *
 * 数据形状与 mint api-v13 一致（BookTitle / tipitaka-read-para）。
 */
import type { ReadParaItem } from "./read-para";
import type { BookTitle, TocItem } from "../catalog";

interface MockSutta extends BookTitle {
  titleZh: string;
  pali: string;
  zh: string;
  note: string; // 边注（Tufte sidenote）
  tags: string[]; // 完整累积标签路径（必填）
}

/** 部分知名经文，用于演示真实感。tag 为完整累积标签路径。 */
const SUTTAS: MockSutta[] = [
  {
    book: 1,
    paragraph: 1,
    sn: "DN 1",
    title: "Brahmajāla Sutta",
    titleZh: "梵网经",
    toc: "Brahmajālasutta",
    tags: ["sutta", "dīghanikāya", "sīlakkhandhavagga"],
    pali: "Evaṁ me sutaṁ — ekaṁ samayaṁ bhagavā antarā ca rājagahaṁ antarā ca nāḷandaṁ addhānamaggappaṭipanno hoti…",
    zh: "如是我闻：一时，世尊游行于王舍城与那烂陀之间的大道……",
    note: "梵网经：长部第一经，总摄六十二见。",
  },
  {
    book: 2,
    paragraph: 2,
    sn: "DN 2",
    title: "Sāmaññaphala Sutta",
    titleZh: "沙门果经",
    toc: "Sāmaññaphalasutta",
    tags: ["sutta", "dīghanikāya", "sīlakkhandhavagga"],
    pali: "Evaṁ me sutaṁ — ekaṁ samayaṁ bhagavā rājagahe viharati jīvakassa komārabhaccassa ambavane…",
    zh: "如是我闻：一时，世尊住于王舍城耆婆童子庵罗园……",
    note: "沙门果经：宣说出家修行之现见功德。",
  },
  {
    book: 3,
    paragraph: 3,
    sn: "DN 16",
    title: "Mahāparinibbāna Sutta",
    titleZh: "大般涅槃经",
    toc: "Mahāparinibbānasutta",
    tags: ["sutta", "dīghanikāya", "mahāvagga"],
    pali: "Evaṁ me sutaṁ — ekaṁ samayaṁ bhagavā rājagahe viharati gijjhakūṭe pabbate…",
    zh: "如是我闻：一时，世尊住于王舍城灵鹫山……",
    note: "大般涅槃经：长部第十六经，记述佛陀最后游行与入灭。",
  },
  {
    book: 4,
    paragraph: 4,
    sn: "MN 1",
    title: "Mūlapariyāya Sutta",
    titleZh: "根本法门经",
    toc: "Mūlapariyāyasutta",
    tags: ["sutta", "majjhimanikāya", "mūlapaṇṇāsa"],
    pali: "Evaṁ me sutaṁ — ekaṁ samayaṁ bhagavā ukkaṭṭhāyaṁ viharati subhagavane sālarājamūle…",
    zh: "如是我闻：一时，世尊住于郁伽多罗村幸林娑罗王树下……",
    note: "根本法门经：中部第一经，分列诸法根本。",
  },
  {
    book: 5,
    paragraph: 5,
    sn: "SN 56.11",
    title: "Dhammacakkappavattana Sutta",
    titleZh: "转法轮经",
    toc: "Dhammacakkappavattanasutta",
    tags: ["sutta", "saṃyuttanikāya", "mahāvagga"],
    pali: "Idaṁ kho pana, bhikkhave, dukkhaṁ ariya-saccaṁ: jāti pi dukkhā, jarā pi dukkhā, byādhi pi dukkho, maraṇam pi dukkhaṁ…",
    zh: "诸比丘！此是苦圣谛：生是苦，老是苦，病是苦，死是苦……",
    note: "转法轮经：佛陀初转法轮，宣说四圣谛与八正道。",
  },
  {
    book: 6,
    paragraph: 6,
    sn: "SN 22.59",
    title: "Anattalakkhaṇa Sutta",
    titleZh: "无我相经",
    toc: "Anattalakkhaṇasutta",
    tags: ["sutta", "saṃyuttanikāya", "khandhavagga"],
    pali: "Rūpaṁ, bhikkhave, anattā. Rūpañca hidaṁ, bhikkhave, attā abhavissa…",
    zh: "诸比丘！色是无我。诸比丘！若此色是我……",
    note: "无我相经：开示五蕴无我。",
  },
  {
    book: 7,
    paragraph: 7,
    sn: "Khp 9",
    title: "Mettā Sutta",
    titleZh: "慈经",
    toc: "Mettāsutta",
    tags: ["sutta", "khuddakanikāya", "khuddakapāṭha"],
    pali: "Karaṇīyam-attha-kusalena, yan-taṁ santaṁ padaṁ abhisamecca…",
    zh: "善巧于义利者，应如是行，以达寂静之境……",
    note: "慈经：小诵第九经，修习慈心之要典。",
  },
  {
    book: 8,
    paragraph: 8,
    sn: "Dhp",
    title: "Dhammapada",
    titleZh: "法句经",
    toc: "Dhammapada",
    tags: ["sutta", "khuddakanikāya", "dhammapada"],
    pali: "Manopubbaṅgamā dhammā, manoseṭṭhā manomayā…",
    zh: "诸法意先导，意主意造作……",
    note: "法句经：小部法句，佛教格言集。",
  },
];

const startsWithTag = (tags: string[], prefix: string[]): boolean =>
  prefix.every((t, i) => tags[i] === t);

export function mockGetBookTitles(tags: string[]): Promise<BookTitle[]> {
  const known = SUTTAS.filter((s) => startsWithTag(s.tags, tags)).map(
    ({ titleZh, pali, zh, note, ...book }) => ({ ...book, title: titleZh }),
  );

  // 无知名经文命中时，生成占位书目，保证任意叶子节点都有内容。
  if (known.length === 0) {
    const last = tags[tags.length - 1] ?? "chapter";
    const generated: BookTitle[] = Array.from({ length: 3 }, (_, i) => ({
      book: 900 + tags.length * 10 + i,
      paragraph: i + 1,
      sn: `${last.toUpperCase()} ${i + 1}`,
      title: `${last} 第 ${i + 1} 经`,
      toc: `${last}-${i + 1}`,
      tags,
    }));
    return Promise.resolve(generated);
  }

  return Promise.resolve(known);
}

export function mockGetChapterToc(book: number): Promise<TocItem[]> {
  const sutta = SUTTAS.find((s) => s.book === book);
  if (!sutta) {
    return Promise.resolve([
      { book, paragraph: 1, pali_title: "第一段", level: 1 },
      { book, paragraph: 2, pali_title: "第二段", level: 1 },
    ]);
  }
  return Promise.resolve([
    { book, paragraph: sutta.paragraph, pali_title: sutta.toc, level: 1 },
  ]);
}

/**
 * 阅读模式段落的离线占位数据（对应 `tipitaka-read-para`）。
 *
 * 逐段返回，形状与真实接口的 `items` 一致；空段由缓存层记为 ''。
 */
export function mockReadParas(
  book: number,
  from: number,
  to: number,
): Promise<ReadParaItem[]> {
  const sutta = SUTTAS.find((s) => s.book === book);
  const pali = sutta?.pali ?? "Sabbe saṅkhārā aniccā…";
  const zh = sutta?.zh ?? "诸行无常……";
  const note = sutta?.note ?? "此为示例占位经文。";
  const texts = [pali, zh, note];

  const items: ReadParaItem[] = [];
  for (let para = from; para <= to; para++) {
    items.push({
      para,
      display:
        `<div class='original' data-para='${para}'><div class='para-block'>` +
        `<div class='sentence origin'><span><span>` +
        texts[(para - from) % texts.length] +
        `</span></span></div></div></div>`,
    });
  }
  return Promise.resolve(items);
}

