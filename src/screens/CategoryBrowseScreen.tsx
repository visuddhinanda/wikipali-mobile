import React from "react";
import { FlatList, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Breadcrumb } from "../components/Breadcrumb";
import { CategoryRow } from "../components/CategoryRow";
import { isLeaf } from "../catalog";
import { label } from "../catalog/labels";
import { useI18n } from "../i18n/I18nContext";
import { spacing } from "../theme";
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
        renderItem={({ item }) => (
          <CategoryRow
            node={item}
            count={isLeaf(item) ? null : item.children?.length ?? 0}
            onPress={() => openChild(item)}
          />
        )}
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
});
