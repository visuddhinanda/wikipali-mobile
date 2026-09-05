/**
 * API 服务器选择页（「我 → 设置 → API 服务器」下钻）。
 *
 * `.env` 的 `EXPO_PUBLIC_API_URL` 一旦设置就会盖过这里的选择
 * （见 `src/api/config.ts`），所以此时把列表置灰并明确说明，
 * 避免用户以为选了没生效是 bug。
 */
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

export function ApiServerSettingsScreen() {
  const t = useT();
  const [server, setServer] = useState<string>(DEFAULT_SERVER);
  const overridden = !!ENV_API_URL;

  useEffect(() => {
    getApiServer().then(setServer);
  }, []);

  const choose = (id: string) => {
    setServer(id);
    void setApiServer(id);
  };

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.hint}>{t("settings.apiServerHint")}</Text>

      {overridden ? (
        <Text style={styles.overrideNote}>
          {t("settings.envOverride", { url: ENV_API_URL })}
        </Text>
      ) : null}

      {API_SERVERS.map((s) => {
        const active = s.id === server;
        return (
          <Pressable
            key={s.id}
            style={[
              styles.row,
              active && styles.rowActive,
              overridden && styles.rowDisabled,
            ]}
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
  overrideNote: {
    ...type.small,
    color: colors.ochre,
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
  rowDisabled: {
    opacity: 0.5,
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
