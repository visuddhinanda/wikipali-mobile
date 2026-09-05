/**
 * 界面语言的 React 绑定。
 *
 * 「跟随系统」时会订阅系统语言变化（Android 上用户可以单独改 App 语言，
 * iOS 改语言会重启 App），切换后立即重渲染，不需要重启。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocales } from "expo-localization";
import {
  detectSystemLocale,
  getLocalePreference,
  setActiveLocale,
  setLocalePreference,
  translate,
  type Locale,
  type LocalePreference,
  type MessageKey,
} from "./index";

interface I18nState {
  /** 实际生效的语言。 */
  locale: Locale;
  /** 用户的选择（`system` 表示跟随系统）。 */
  preference: LocalePreference;
  setPreference: (p: LocalePreference) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");
  // 订阅系统语言：`system` 偏好下语言变化要能立刻反映出来。
  // 原生模块缺失时（尚未重建的旧 dev client）退回 null，由 detectSystemLocale 兜底。
  let systemLocales: unknown = null;
  try {
    systemLocales = useLocales();
  } catch {
    systemLocales = null;
  }

  useEffect(() => {
    let alive = true;
    getLocalePreference().then((p) => {
      if (alive) setPreferenceState(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const locale = useMemo<Locale>(
    () => (preference === "system" ? detectSystemLocale() : preference),
    // systemLocales 变化时要重算「跟随系统」的结果
    [preference, systemLocales],
  );

  // 让 `src/api/*` 等非组件模块的 `t()` 跟上当前语言。
  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  const setPreference = useCallback((p: LocalePreference) => {
    setPreferenceState(p);
    void setLocalePreference(p);
  }, []);

  const value = useMemo<I18nState>(
    () => ({
      locale,
      preference,
      setPreference,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, preference, setPreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** 只要翻译函数时的简写。 */
export function useT() {
  return useI18n().t;
}
