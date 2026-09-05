/**
 * 「关于 / 反馈」页（「我 → 设置 → 关于 / 反馈」下钻）。
 *
 * 外部地址集中在 `src/settings/about.ts`；其中反馈地址允许留空 ——
 * 留空时该行置灰不可点并标注「尚未配置」，而不是渲染成点了没反应的死链接。
 */
import React from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type, serifFont } from "../theme";
import { useT } from "../i18n/I18nContext";
import {
  FEEDBACK_URL,
  LICENSE,
  SOURCE_URL,
  WEBSITE_URL,
} from "../settings/about";

type IoniconName = keyof typeof Ionicons.glyphMap;

/** 打开外部链接；无法处理的 URL（如未装邮件客户端）静默忽略，不弹错误。 */
async function open(url: string) {
  try {
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  } catch {
    // 打不开就算了，这里没有值得打扰用户的信息
  }
}

function LinkRow({
  icon,
  label,
  value,
  url,
  emptyNote,
}: {
  icon: IoniconName;
  label: string;
  /** 右侧副文本（如版本号、许可证名）。 */
  value?: string;
  /** 留空表示尚未配置，此时该行不可点。 */
  url?: string;
  emptyNote?: string;
}) {
  const disabled = !url;
  return (
    <Pressable
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={() => url && void open(url)}
      disabled={disabled}
    >
      <Ionicons name={icon} size={20} color={colors.inkSoft} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {disabled && emptyNote ? (
          <Text style={styles.rowNote}>{emptyNote}</Text>
        ) : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {!disabled ? (
        <Ionicons name="open-outline" size={16} color={colors.inkFaint} />
      ) : null}
    </Pressable>
  );
}

export function AboutScreen() {
  const t = useT();

  // 版本号取自 app.json 的 expo.version，构建时内联，不会和实际包脱节。
  const version = Constants.expoConfig?.version ?? "—";

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <Ionicons name="book" size={32} color={colors.paperRaised} />
        </View>
        <Text style={styles.appName}>法音</Text>
        <Text style={styles.version}>{t("about.version", { version })}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t("about.section.about")}</Text>
      <LinkRow icon="globe-outline" label={t("about.website")} url={WEBSITE_URL} />
      <LinkRow icon="logo-github" label={t("about.sourceCode")} url={SOURCE_URL} />
      <LinkRow
        icon="document-text-outline"
        label={t("about.license")}
        value={LICENSE}
      />

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>{t("about.section.feedback")}</Text>
      <Text style={styles.sectionHint}>{t("about.feedbackHint")}</Text>
      <LinkRow
        icon="chatbox-ellipses-outline"
        label={t("about.sendFeedback")}
        url={FEEDBACK_URL || undefined}
        emptyNote={t("about.feedbackUnset")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xl,
  },
  hero: {
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xl,
  },
  mark: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.vermilion,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  appName: {
    ...type.title,
    fontFamily: serifFont,
  },
  version: {
    ...type.caption,
  },
  sectionTitle: {
    ...type.heading,
    marginBottom: spacing.xs,
  },
  sectionHint: {
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
  rowDisabled: {
    opacity: 0.5,
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    ...type.body,
  },
  rowNote: {
    ...type.small,
    marginTop: 2,
    color: colors.ochre,
  },
  rowValue: {
    ...type.small,
    color: colors.inkSoft,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
});
