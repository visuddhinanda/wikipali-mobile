/**
 * 书架 → 批量下载：按界面语言的语族列出译本频道，选一个进详情整批下载。
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { ChannelRow } from "../components/ChannelRow";
import { fetchTranslationChannels, type ChannelSummary } from "../api/channels";
import { listDownloads } from "../reading";
import { colors, spacing, type } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n/I18nContext";
import { langFamily } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "ChannelList">;

export function ChannelListScreen({ navigation }: Props) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ChannelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 下过东西的频道排最前面 —— 用户回到这个页面多半是接着下没下完的。
    Promise.all([fetchTranslationChannels(langFamily(locale)), listDownloads()])
      .then(([r, downloads]) => {
        if (!alive) return;
        const has = new Set(
          downloads.filter((d) => d.done > 0).map((d) => d.channel),
        );
        setRows(
          [...r].sort((a, b) => Number(has.has(b.id)) - Number(has.has(a.id))),
        );
      })
      .catch((err) =>
        alive
          ? setError(
              err instanceof Error ? err.message : t("common.loadFailed"),
            )
          : undefined,
      );
    return () => {
      alive = false;
    };
  }, [locale]);

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.hint}>{t("channelList.hint")}</Text>
      {error ? (
        <Text style={styles.empty}>{error}</Text>
      ) : rows === null ? (
        <ActivityIndicator color={colors.vermilion} style={styles.loading} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>{t("channelList.empty")}</Text>
      ) : (
        <View>
          {rows.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              onPress={() =>
                navigation.navigate("ChannelDetail", {
                  uid: c.id,
                  name: c.name,
                  mode: "download",
                })
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  hint: {
    ...type.caption,
    marginBottom: spacing.lg,
  },
  loading: {
    marginTop: spacing.xl,
  },
  empty: {
    ...type.caption,
    textAlign: "center",
    marginTop: spacing.xl,
  },
});
