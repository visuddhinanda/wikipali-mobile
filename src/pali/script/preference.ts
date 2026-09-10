/**
 * 阅读器用哪种巴利字体。
 *
 * 默认跟随界面语言：斯里兰卡、缅甸、泰国的读者看本国文字的巴利，其余一律
 * 罗马巴利 —— 这是各国三藏印本的实际习惯，不是随便挑的。用户可在阅读器
 * 设置里手工指定，指定之后不再跟随语言。
 */
import type { Locale } from "../../i18n";
import type { TargetScript } from "./convert";

/** `auto` = 跟随界面语言。 */
export type PaliScriptPreference = "auto" | TargetScript;

/**
 * 界面语言 → 该国通行的巴利字体。
 *
 * 锡兰文取**传统正字法**（`sinhala1`）：斯里兰卡的巴利印本用的是带 ZWJ
 * 连写的传统式，现代式是给僧伽罗语文本用的。
 */
const BY_LOCALE: Partial<Record<Locale, TargetScript>> = {
  si: "sinhala1",
  my: "myanmar",
  th: "thai",
};

export function resolvePaliScript(
  pref: PaliScriptPreference,
  locale: Locale,
): TargetScript {
  if (pref !== "auto") return pref;
  return BY_LOCALE[locale] ?? "roman";
}
