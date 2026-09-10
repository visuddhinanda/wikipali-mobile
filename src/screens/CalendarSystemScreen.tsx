/**
 * 历法选择（界面稿屏 5）。
 *
 * 五套算法各有出处与适用人群，并列说清楚，而不是塞进一个下拉框 ——
 * 用户凭每项那一句判断该信哪个；完整参考文献在 `docs/buddhist-calendar.md` §2。
 *
 * 没设置过就跟随界面语言（与巴利字体的 `auto` 一个策略），设过就一直用他选的。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useI18n, useT } from "../i18n/I18nContext";
import { CALENDAR_SYSTEMS, defaultSystemFor, isSystemAvailable } from "../calendar/lunar";
import { SYSTEM_DESC_KEYS, SYSTEM_TITLE_KEYS } from "../calendar/systems";
import { useCalendarSystem } from "../calendar/useCalendar";

export function CalendarSystemScreen() {
  const t = useT();
  const { locale } = useI18n();
  const navigation = useNavigation();
  const [current, setSystem] = useCalendarSystem(defaultSystemFor(locale));

  return (
    <Screen contentStyle={styles.content}>
      {CALENDAR_SYSTEMS.map((system) => {
        const on = system === current;
        return (
          <Pressable
            key={system}
            disabled={!isSystemAvailable(system)}
            style={[styles.row, on && styles.rowOn, !isSystemAvailable(system) && styles.rowOff]}
            onPress={() => {
              setSystem(system);
              navigation.goBack();
            }}
          >
            <View style={styles.text}>
              <Text style={styles.title}>{t(SYSTEM_TITLE_KEYS[system])}</Text>
              <Text style={styles.desc}>{t(SYSTEM_DESC_KEYS[system])}</Text>
            </View>
            {on ? (
              <Ionicons name="checkmark" size={18} color={colors.vermilion} />
            ) : null}
          </Pressable>
        );
      })}
      <Text style={styles.note}>{t("calendar.notice.astronomical")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
  },
  rowOn: { borderColor: colors.vermilion, backgroundColor: colors.paperSunken },
  rowOff: { opacity: 0.5 },
  text: { flex: 1 },
  title: { ...type.body, fontWeight: "700" },
  desc: { ...type.small, color: colors.inkFaint, marginTop: 2 },
  note: { ...type.small, color: colors.inkFaint, marginTop: spacing.md },
});
