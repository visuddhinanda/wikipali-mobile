import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { API_SERVERS, DEFAULT_SERVER, getApiServer } from "../settings/server";
import { ENV_API_URL } from "../api/config";
import { colors, radius, spacing, type } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n/I18nContext";
import { LOCALE_OPTIONS } from "../i18n";
import type { MessageKey } from "../i18n";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [server, setServer] = useState<string>(DEFAULT_SERVER);
  const { t, preference, locale } = useI18n();

  // 「跟随系统」时显示实际生效的语言，让用户一眼看到当前是哪种。
  const currentLanguageLabel =
    preference === "system"
      ? `${t("settings.language.system")} · ${
          LOCALE_OPTIONS.find((o) => o.id === locale)?.label ?? locale
        }`
      : (LOCALE_OPTIONS.find((o) => o.id === preference)?.label ?? preference);

  // .env 覆盖时选择不生效，直接显示真正在用的地址，免得看起来像 bug。
  const currentServerLabel =
    ENV_API_URL ||
    (API_SERVERS.find((s) => s.id === server)?.label ?? server);

  // 从下级页面返回时要反映刚改过的选择，所以每次获得焦点都重读一次。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getApiServer().then((v) => {
        if (alive) setServer(v);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <Screen contentStyle={styles.content}>
      {/* 界面语言：详情在下级页面，这里只显示当前值 */}
      <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate("LanguageSettings")}
      >
        <Ionicons name="language" size={20} color={colors.inkSoft} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{currentLanguageLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      <View style={styles.divider} />

      {/* API 服务器：详情在下级页面，这里只显示当前生效的值 */}
      <Text style={styles.sectionTitle}>{t("settings.apiServer")}</Text>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate("ApiServerSettings")}
      >
        <Ionicons name="server-outline" size={20} color={colors.inkSoft} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{currentServerLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>{t("settings.others")}</Text>
      {(
        [
          { icon: "text", label: "settings.display" as MessageKey },
          { icon: "download", label: "settings.downloads" as MessageKey },
          { icon: "information-circle", label: "settings.about" as MessageKey },
        ]
      ).map((row) => (
        <Pressable key={row.label} style={styles.row} onPress={() => undefined}>
          <Ionicons name={row.icon as any} size={20} color={colors.inkSoft} />
          <Text style={styles.rowLabel}>{t(row.label)}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  sectionTitle: {
    ...type.heading,
    marginBottom: spacing.xs,
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
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    ...type.body,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
});
