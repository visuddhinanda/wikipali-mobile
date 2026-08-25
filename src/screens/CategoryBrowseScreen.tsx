import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { isLeaf } from "../catalog";
import { labelZh } from "../catalog/labels";
import { colors, radius, spacing, type, serifFont } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "CategoryBrowse">;

export function CategoryBrowseScreen({ route, navigation }: Props) {
  const { node, breadcrumb } = route.params;
  const children = node.children ?? [];

  const openChild = (child: (typeof children)[number]) => {
    if (isLeaf(child)) {
      navigation.navigate("ChapterList", {
        tagPath: child.tag,
        title: labelZh(child.name),
      });
    } else {
      navigation.push("CategoryBrowse", {
        node: child,
        breadcrumb: [...breadcrumb, labelZh(child.name)],
      });
    }
  };

  return (
    <Screen scroll={false} contentStyle={styles.contentFill}>
      {/* 面包屑 */}
      <View style={styles.breadcrumb}>
        {breadcrumb.map((name, i) => (
          <Text key={`${name}-${i}`} style={styles.breadcrumbText}>
            {i > 0 ? "  /  " : ""}
            {name}
          </Text>
        ))}
        <Text style={styles.breadcrumbCount}> · {children.length} 项</Text>
      </View>

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
                <Text style={styles.rowZh}>{labelZh(item.name)}</Text>
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
  breadcrumb: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  breadcrumbText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  breadcrumbCount: {
    ...type.caption,
    color: colors.inkFaint,
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
