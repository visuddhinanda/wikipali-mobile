import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Breadcrumb } from "../components/Breadcrumb";
import { isLeaf } from "../catalog";
import { label } from "../catalog/labels";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "CategoryBrowse">;

export function CategoryBrowseScreen({ route, navigation }: Props) {
  const { node, breadcrumb } = route.params;
  const children = node.children ?? [];
  const { t, locale } = useI18n();

  const openChild = (child: (typeof children)[number]) => {
    const name = label(child.name, locale);
    if (isLeaf(child)) {
      navigation.navigate("ChapterList", {
        tagPath: child.tag,
        title: name,
        breadcrumb: [...breadcrumb, name],
      });
    } else {
      navigation.push("CategoryBrowse", {
        node: child,
        breadcrumb: [...breadcrumb, name],
      });
    }
  };

  return (
    <Screen scroll={false} contentStyle={styles.contentFill}>
      {/* 面包屑 */}
      <Breadcrumb
        items={breadcrumb}
        trailing={t("categoryBrowse.count", { n: children.length })}
      />

      <FlatList
        data={children}
        keyExtractor={(item) => item.name}
        style={styles.listFill}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const leaf = isLeaf(item);
          return (
            <Pressable style={styles.row} onPress={() => openChild(item)}>
              <View style={styles.rowBody}>
                <Text style={styles.rowZh}>{label(item.name, locale)}</Text>
                <Text style={styles.rowPali}>{item.name}</Text>
              </View>
              <Text style={styles.rowCount}>{item.children?.length ?? ""}</Text>
              <Ionicons
                name={leaf ? "arrow-forward" : "chevron-forward"}
                size={18}
                color={colors.vermilion}
              />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  rowBody: {
    flex: 1,
  },
  rowZh: {
    ...type.body,
    fontWeight: "600",
    fontFamily: serifFont,
  },
  rowPali: {
    ...type.small,
    marginTop: 2,
    color: colors.inkSoft,
  },
  rowCount: {
    ...type.small,
    marginRight: spacing.sm,
    color: colors.inkFaint,
  },
});
