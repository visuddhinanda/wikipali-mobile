/**
 * 字体的界面名称。
 *
 * 名字一律用**该字体自己的写法**（endonym），不随界面语言变化 —— 和语言
 * 设置页的做法一致：认得自己文字的人，在看不懂的界面语言下也能找到自己那一项。
 * 只有「传统 / 现代」这类限定词才走翻译。
 */
import type { MessageKey } from "../../i18n";
import type { SourceScript, TargetScript } from "./convert";

export interface ScriptLabel {
  /** 该字体自己写法的名字。 */
  name: string;
  /** 需要再加一个限定词时的文案 key（如锡兰文的传统 / 现代）。 */
  noteKey?: MessageKey;
}

const ROMAN: ScriptLabel = { name: "Pāḷi (Roman)" };
const SANGAYANA: ScriptLabel = { name: "Sangayana" };
const MYANMAR: ScriptLabel = { name: "မြန်မာ" };
const THAI: ScriptLabel = { name: "ไทย" };
const TAI_THAM: ScriptLabel = { name: "ᨲᩫ᩠ᩅᨵᨾ᩠ᨾ Tai Tham" };
const TELUGU: ScriptLabel = { name: "తెలుగు" };

export const SOURCE_LABELS: Record<SourceScript, ScriptLabel> = {
  roman: ROMAN,
  sangayana: SANGAYANA,
  sinhala: { name: "සිංහල" },
  myanmar: MYANMAR,
  tai_tham: TAI_THAM,
  thai: THAI,
  tai_old: { name: "ᨲᩫ᩠ᩅ", noteKey: "script.taiOld" },
};

export const TARGET_LABELS: Record<TargetScript, ScriptLabel> = {
  roman: ROMAN,
  sangayana: SANGAYANA,
  sinhala1: { name: "සිංහල", noteKey: "script.traditional" },
  sinhala2: { name: "සිංහල", noteKey: "script.modern" },
  telugu: TELUGU,
  myanmar: MYANMAR,
  tai_tham: TAI_THAM,
  thai: THAI,
};
