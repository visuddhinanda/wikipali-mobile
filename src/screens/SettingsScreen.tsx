import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import {
  API_SERVERS,
  DEFAULT_SERVER,
  getApiServer,
  setApiServer,
} from "../settings/server";
import { ENV_API_URL } from "../api/config";
import { colors, radius, spacing, type } from "../theme";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

export function SettingsScreen() {
  const [server, setServer] = useState<string>(DEFAULT_SERVER);
  const t = useT();

  useEffect(() => {
    getApiServer().then(setServer);
  }, []);

  const choose = (id: string) => {
    setServer(id);
    void setApiServer(id);
  };

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.sectionTitle}>{t("settings.apiServer")}</Text>
      <Text style={styles.sectionHint}>{t("settings.apiServerHint")}</Text>

      {API_SERVERS.map((s) => {
        const active = s.id === server;
        return (
          <Pressable
            key={s.id}
            style={[styles.row, active && styles.rowActive]}
            onPress={() => choose(s.id)}
          >
            <View style={styles.rowBody}>
              <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
                {s.label}
              </Text>
              <Text style={styles.rowSub}>{s.baseUrl}</Text>
            </View>
            <Ionicons
              name={active ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={active ? colors.vermilion : colors.inkFaint}
            />
          </Pressable>
        );
      })}

      {ENV_API_URL ? (
        <Text style={styles.overrideNote}>
          {t("settings.envOverride", { url: ENV_API_URL })}
        </Text>
      ) : null}

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>{t("settings.others")}</Text>
      {(
        [
          { icon: "language", label: "settings.language" as MessageKey },
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
  sectionHint: {
    ...type.caption,
    color: colors.inkSoft,
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
  overrideNote: {
    ...type.small,
    color: colors.ochre,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
});
