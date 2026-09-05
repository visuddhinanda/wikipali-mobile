/**
 * 语言选择页（「我 → 设置 → 语言偏好」下钻）。
 *
 * 每一项左侧是该语言的**自称名**，右侧副标题用当前界面语言标注 ——
 * 这样既能让母语用户认出自己的语言，又能让当前用户看懂自己选的是什么。
 * 「跟随系统」额外标出系统当前解析到的是哪一种。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import {
  LOCALE_OPTIONS,
  detectSystemLocale,
  type Locale,
  type LocalePreference,
} from "../i18n";

/** 语言自称名（用于「跟随系统」那行的副标题）。 */
function endonym(locale: Locale): string {
  return LOCALE_OPTIONS.find((o) => o.id === locale)?.label ?? locale;
}

export function LanguageSettingsScreen() {
  const { t, preference, setPreference } = useI18n();
  const systemLocale = detectSystemLocale();

  const rows: { id: LocalePreference; label: string; sub?: string }[] = [
    {
      id: "system",
      label: t("settings.language.system"),
      sub: endonym(systemLocale),
    },
    ...LOCALE_OPTIONS.map((o) => ({ id: o.id as LocalePreference, label: o.label })),
  ];

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.hint}>{t("settings.languageHint")}</Text>

      {rows.map((row) => {
        const active = row.id === preference;
        return (
          <Pressable
            key={row.id}
            style={[styles.row, active && styles.rowActive]}
            onPress={() => setPreference(row.id)}
          >
            <View style={styles.rowBody}>
              <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
                {row.label}
              </Text>
              {row.sub ? <Text style={styles.rowSub}>{row.sub}</Text> : null}
            </View>
            <Ionicons
              name={active ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={active ? colors.vermilion : colors.inkFaint}
            />
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  hint: {
    ...type.caption,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  rowActive: {
    borderColor: colors.vermilion,
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    ...type.body,
  },
  rowLabelActive: {
    color: colors.vermilion,
    fontWeight: "600",
  },
  rowSub: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
});
