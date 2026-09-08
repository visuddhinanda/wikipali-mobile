/**
 * 译本频道的一行：工作室头像 + 频道名 + 工作室/段数。
 * 分类页的「译本合集」与书架的「批量下载」列表共用。
 */
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { studioLabel, type ChannelSummary } from "../api/channels";
import { colors, radius, spacing, type, serifFont } from "../theme";
import { useT } from "../i18n/I18nContext";

export function ChannelRow({
  channel,
  subtitle,
  onPress,
}: {
  channel: ChannelSummary;
  /** 覆盖副标题（书架「已下载」用「N 本已下载」代替译文段数）。 */
  subtitle?: string;
  onPress: () => void;
}) {
  const t = useT();
  const studio = studioLabel(channel.studio);
  const sub = [studio, subtitle ?? t("channel.paraCount", { n: channel.count })]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Avatar uri={channel.studio?.avatar} name={channel.name} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.vermilion} />
    </Pressable>
  );
}

/** 头像；没有图就用名字首字占位（签名的 S3 链接过期时也是这个下场）。 */
export function Avatar({
  uri,
  name,
  size = 40,
}: {
  uri?: string;
  name?: string;
  size?: number;
}) {
  const [failed, setFailed] = React.useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.avatar, box]}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, box]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>
        {(name ?? "?").slice(0, 1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  body: {
    flex: 1,
  },
  title: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  sub: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  avatar: {
    backgroundColor: colors.paperSunken,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.inkSoft,
    fontFamily: serifFont,
  },
});
