/**
 * 历法选择：五套算法各有出处与适用人群，并列说清楚，而不是塞进一个下拉框。
 * 用户凭每项那一句判断该信哪个；完整参考文献在 `docs/buddhist-calendar.md` §2。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
import { CALENDAR_SYSTEMS, isSystemAvailable, type CalendarSystem } from "../calendar/lunar";

const TITLES: Record<CalendarSystem, MessageKey> = {
  astro: "calendar.system.astro",
  myanmar: "calendar.system.myanmar",
  srilanka: "calendar.system.srilanka",
  thai: "calendar.system.thai",
  chinese: "calendar.system.chinese",
};

const DESCS: Record<CalendarSystem, MessageKey> = {
  astro: "calendar.system.astro.desc",
  myanmar: "calendar.system.myanmar.desc",
  srilanka: "calendar.system.srilanka.desc",
  thai: "calendar.system.thai.desc",
  chinese: "calendar.system.chinese.desc",
};

export function CalendarSystemScreen() {
  const t = useT();
  return (
    <Screen contentStyle={styles.content}>
      {CALENDAR_SYSTEMS.map((system) => (
        <View
          key={system}
          style={[styles.row, !isSystemAvailable(system) && styles.rowOff]}
        >
          <Text style={styles.title}>{t(TITLES[system])}</Text>
          <Text style={styles.desc}>{t(DESCS[system])}</Text>
        </View>
      ))}
      <Text style={styles.note}>{t("calendar.notice.astronomical")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, gap: spacing.sm },
  row: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
  },
  rowOff: { opacity: 0.5 },
  title: { ...type.body, fontWeight: "700" },
  desc: { ...type.small, color: colors.inkFaint, marginTop: 2 },
  note: { ...type.small, color: colors.inkFaint, marginTop: spacing.md },
});
