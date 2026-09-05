import type { Locale } from "../i18n";

/**
 * 目录节点的多语言显示名映射（Pali 转写名 → 中文 / 英文）。
 * 未知节点回退到 Pali 原名。
 */
const LABELS: Record<string, { zh?: string; en?: string }> = {
  // 三藏 + 藏外
  suttapiṭaka: { zh: "经藏", en: "Sutta Piṭaka" },
  vinayapiṭaka: { zh: "律藏", en: "Vinaya Piṭaka" },
  abhidhammapiṭaka: { zh: "论藏", en: "Abhidhamma Piṭaka" },
  añña: { zh: "藏外", en: "Añña" },

  // 经藏 · 五部
  dīghanikāya: { zh: "长部", en: "Dīgha Nikāya" },
  majjhimanikāya: { zh: "中部", en: "Majjhima Nikāya" },
  saṃyuttanikāya: { zh: "相应部", en: "Saṃyutta Nikāya" },
  aṅguttaranikāya: { zh: "增支部", en: "Aṅguttara Nikāya" },
  khuddakanikāya: { zh: "小部", en: "Khuddaka Nikāya" },

  // 长部 · 品
  sīlakkhandhavagga: { zh: "戒蕴品" },
  pāthikavagga: { zh: "波梨品" },

  // 中部 · 篇
  mūlapaṇṇāsa: { zh: "根本五十篇" },
  majjhimapaṇṇāsa: { zh: "中五十篇" },
  uparipaṇṇāsa: { zh: "后五十篇" },

  // 相应部 · 品
  sagāthāvagga: { zh: "有偈品" },
  nidānavagga: { zh: "因缘品" },
  khandhavagga: { zh: "蕴品" },
  saḷāyatanavagga: { zh: "六处品" },

  // 增支部 · 集
  ekakanipāta: { zh: "一集" },
  dukanipāta: { zh: "二集" },
  tikanipāta: { zh: "三集" },
  catukkanipāta: { zh: "四集" },
  pañcakanipāta: { zh: "五集" },
  chakkanipāta: { zh: "六集" },
  sattakanipāta: { zh: "七集" },
  aṭṭhakanipāta: { zh: "八集" },
  navakanipāta: { zh: "九集" },
  dasakanipāta: { zh: "十集" },
  ekādasakanipāta: { zh: "十一集" },

  // 小部
  khuddakapāṭha: { zh: "小诵" },
  dhammapada: { zh: "法句" },
  udāna: { zh: "自说" },
  itivuttaka: { zh: "如是语" },
  suttanipāta: { zh: "经集" },
  vimānavatthu: { zh: "天宫事" },
  petavatthu: { zh: "饿鬼事" },
  theragāthā: { zh: "长老偈" },
  therīgāthā: { zh: "长老尼偈" },
  therāpadāna: { zh: "长老譬喻" },
  buddhavaṃsa: { zh: "佛种姓" },
  cariyāpiṭaka: { zh: "所行藏" },
  jātaka: { zh: "本生" },
  mahāniddesa: { zh: "大义释" },
  cūḷaniddesa: { zh: "小义释" },
  paṭisambhidāmagga: { zh: "无碍解道" },
  nettippakaraṇa: { zh: "导论" },
  milindapañha: { zh: "弥兰王问经" },
  peṭakopadesa: { zh: "藏释" },

  // 律藏
  mahāvibhaṅga: { zh: "比丘分别" },
  bhikkhunīvibhaṅga: { zh: "比丘尼分别" },
  mahāvagga: { zh: "大品" },
  cūḷavagga: { zh: "小品" },
  parivāra: { zh: "附随" },
  ṭīkā: { zh: "注疏" },
  sāratthadīpanī: { zh: "一切善见律疏" },
  pātimokkha: { zh: "波罗提木叉" },
  vajirabuddhi: { zh: "金刚智疏" },
  vimativinodanī: { zh: "疑网解" },
  vinayavinicchayo: { zh: "律决定" },
  vinayasaṅgaha: { zh: "律摄" },
  vinayālaṅkāra: { zh: "律庄严" },
  uttaravinicchaya: { zh: "上决定" },
  pācityādiyojanā: { zh: "波逸提等" },
  khuddasikkhā: { zh: "小戒" },
  mūlasikkhā: { zh: "根本戒" },

  // 论藏
  dhammasaṅgaṇī: { zh: "法集论" },
  vibhaṅga: { zh: "分别论" },
  dhātukathā: { zh: "界论" },
  puggalapaññatti: { zh: "人施设论" },
  kathāvatthu: { zh: "论事" },
  yamaka: { zh: "双论" },
  paṭṭhāna: { zh: "发趣论" },
  abhidhammatthasaṅgaha: { zh: "摄阿毗达磨义论" },
  abhidhammāvatāra: { zh: "阿毗达磨入门" },
  nāmarūpaparicchedo: { zh: "名色分别" },
  paramatthavinicchayo: { zh: "胜义决定" },
  saccasaṅkhepo: { zh: "谛摄" },
  abhidhammamātikāpāḷi: { zh: "阿毗达磨论母" },
  mohavicchedanī: { zh: "断痴论" },

  // 藏外
  visuddhimagga: { zh: "清净道论", en: "Visuddhimagga" },
  "saṃgāyanassa-pucchā vissajjanā": { zh: "结集问答" },
  "leḍī sayādo gantha-saṅgaho": { zh: "缅甸尊者论集" },
  "buddha-vandanā gantha-saṅgaho": { zh: "佛陀礼赞集" },
  "vaṃsa gantha-saṅgaho": { zh: "史传集" },
  "byākaraṇa gantha-saṅgaho": { zh: "文法集" },
};

export function labelZh(name: string): string {
  return LABELS[name]?.zh ?? name;
}

export function labelEn(name: string): string | undefined {
  return LABELS[name]?.en;
}

/**
 * 按界面语言取目录节点的显示名。
 *
 * 这张表目前只有 `zh` / `en` 两栏：
 * - 简体、繁体中文都取 `zh`（繁体暂无独立译名，见 `docs/i18n.md` 的待办）
 * - 其余语言取 `en`，缺条目时回退 Pali 转写原名 —— Pali 本身就是各国
 *   佛教文献里通行的写法，比强行显示中文更可读。
 */
export function label(name: string, locale: Locale): string {
  const entry = LABELS[name];
  if (!entry) return name;
  const zhLike = locale === "zh-Hans" || locale === "zh-Hant";
  return (zhLike ? entry.zh : entry.en) ?? name;
}
