# 三藏分类（细化）

> 目录树对应 `mint/api-v13/public/data/category/default.json`。移动端**仅使用 `default.json`**，
> 不引入 CSCD4 数据集，也不做 Default / CSCD4 版本切换。
> 本文从总设计入口 [`README.md`](./README.md) 的「三藏分类」一节独立出来。

## 2.1 经藏 · Sutta Piṭaka

- **长部 · Dīgha Nikāya**：戒蕴品 sīlakkhandhavagga · 大品 mahāvagga · 波梨品 pāthikavagga
- **中部 · Majjhima Nikāya**：根本五十篇 mūlapaṇṇāsa · 中五十篇 majjhimapaṇṇāsa · 后五十篇 uparipaṇṇāsa
- **相应部 · Saṃyutta Nikāya**：有偈品 sagāthāvagga · 因缘品 nidānavagga · 蕴品 khandhavagga · 六处品 saḷāyatanavagga · 大品 mahāvagga
- **增支部 · Aṅguttara Nikāya**：一集 ekakanipāta ～ 十一集 ekādasakanipāta（11 集）
- **小部 · Khuddaka Nikāya**：小诵 khuddakapāṭha · 法句 dhammapada · 自说 udāna · 如是语 itivuttaka · 经集 suttanipāta · 天宫事 vimānavatthu · 饿鬼事 petavatthu · 长老偈 theragāthā · 长老尼偈 therīgāthā · 本生 jātaka · 义释（大/小）niddesa · 无碍解道 paṭisambhidāmagga · 譬喻 apadāna · 佛种姓 buddhavaṃsa · 所行藏 cariyāpiṭaka · 导论 nettippakaraṇa · 弥兰王问经 milindapañha · 藏释 peṭakopadesa

## 2.2 律藏 · Vinaya Piṭaka

- **经分别**：比丘分别 mahāvibhaṅga · 比丘尼分别 bhikkhunīvibhaṅga
- **犍度**：大品 mahāvagga · 小品 cūḷavagga
- **附随**：parivāra
- **注疏 ṭīkā**：一切善见律疏 · 波罗提木叉 · 戒本疏 · 律决定 · 律摄 · 律庄严 · 上决定 · 波逸提等（sāratthadīpanī / pātimokkha / vajirabuddhi / vimativinodanī / vinayavinicchayo / vinayasaṅgaha / vinayālaṅkāra / uttaravinicchaya / pācityādiyojanā / khuddasikkhā / mūlasikkhā）

## 2.3 论藏 · Abhidhamma Piṭaka（七论）

法集论 dhammasaṅgaṇī · 分别论 vibhaṅga · 界论 dhātukathā · 人施设论 puggalapaññatti · 论事 kathāvatthu · 双论 yamaka · 发趣论 paṭṭhāna
- **藏外 añña**：摄阿毗达磨义论 abhidhammatthasaṅgaha · 阿毗达磨入门 · 名色分别 · 胜义决定 · 谛摄 · 阿毗达磨论母 · 断痴论等

## 2.4 藏外 · Añña（非正藏）

清净道论 visuddhimagga（+ 大疏 + 因缘谈）· 结集问答 · 缅甸尊者论集 · 佛陀礼赞集 · 史传集（岛史/教史/大史）· 文法集（迦旃延/目犍连文法等）

## 2.5 分类树在 App 中的交互

- 目录节点带 `tag` 路径（如 `["sutta","dīghanikāya","mahāvagga"]`），用于：命中 OpenSearch 过滤、传给阅读器的章节定位、传给探索（AI 问答）的 `passage id` 上下文
- 三级展开：**藏 → 部/类 → 品/集 → 经/章**；末级进入阅读器
- 「作者筛选」= 平行语文维度（Pali / 中文 / 缅文 / 泰文 / 僧伽罗），与目录树正交，切换后树仍不变、内容按语文过滤
