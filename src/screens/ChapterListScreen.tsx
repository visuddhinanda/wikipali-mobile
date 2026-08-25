import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { getBooksByTags, bookKindLabel } from "../catalog";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ChapterList">;

/** 书目分类排序：根本 → 义注 → 复注。 */
const KIND_RANK: Record<string, number> = {
  根本: 0,
  义注: 1,
  复注: 2,
};

export function ChapterListScreen({ route, navigation }: Props) {
  const { tagPath, title } = route.params;
  const books = getBooksByTags(tagPath).sort(
    (a, b) =>
      (KIND_RANK[bookKindLabel(a.tags)] ?? 0) -
      (KIND_RANK[bookKindLabel(b.tags)] ?? 0),
  );

  return (
    <Screen scroll={false} contentStyle={styles.contentFill}>
      <View style={styles.subheader}>
        <Text style={styles.subheaderText}>
          {title} · {books.length} 篇
        </Text>
      </View>

      {books.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="library-outline" size={40} color={colors.inkFaint} />
          <Text style={styles.centerText}>该目录暂无书籍</Text>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => `${item.book}-${item.paragraph}`}
          style={styles.listFill}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                navigation.navigate("BookChannels", {
                  book: item.book,
                  paragraph: item.paragraph,
                  title: item.title,
                })
              }
            >
              <View style={styles.kind}>
                <Text style={styles.kindText}>{bookKindLabel(item.tags)}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                {item.toc ? <Text style={styles.rowToc}>{item.toc}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.vermilion} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  centerText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  subheader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  subheaderText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  contentFill: {
    flex: 1,
  },
  listFill: {
    flex: 1,
  },
  list: {
    padding: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  kind: {
    minWidth: 40,
    paddingRight: spacing.md,
  },
  kindText: {
    ...type.caption,
    fontWeight: "600",
    color: colors.ochre,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  rowToc: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
});
