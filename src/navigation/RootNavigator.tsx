import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "../theme";
import { useLayout } from "../hooks/useLayout";
import type { RootStackParamList, TabParamList } from "./types";
import { DiscoverScreen } from "../screens/DiscoverScreen";
import { CategoryBrowseScreen } from "../screens/CategoryBrowseScreen";
import { ChapterListScreen } from "../screens/ChapterListScreen";
import { BookChannelsScreen } from "../screens/BookChannelsScreen";
import { ReaderScreen } from "../screens/ReaderScreen";
import { BookshelfScreen } from "../screens/BookshelfScreen";
import { AiChatScreen } from "../screens/AiChatScreen";
import { ToolsScreen } from "../screens/ToolsScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { NewChatScreen } from "../screens/NewChatScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.vermilion,
    background: colors.paper,
    card: colors.paperRaised,
    text: colors.ink,
    border: colors.hairline,
  },
};

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<
  keyof TabParamList,
  { active: IoniconName; inactive: IoniconName; label: string }
> = {
  Discover: { active: "grid", inactive: "grid-outline", label: "分类" },
  Bookshelf: { active: "book", inactive: "book-outline", label: "书架" },
  AiChat: {
    active: "chatbubble-ellipses",
    inactive: "chatbubble-ellipses-outline",
    label: "探索",
  },
  Tools: { active: "apps", inactive: "apps-outline", label: "工具" },
  Profile: { active: "person", inactive: "person-outline", label: "我" },
};

function TabBarIcon({
  name,
  focused,
  raised,
}: {
  name: IoniconName;
  focused: boolean;
  raised?: boolean;
}) {
  const icon = (
    <Ionicons
      name={name}
      size={raised ? 26 : 23}
      color={raised ? colors.paperRaised : focused ? colors.vermilion : colors.inkFaint}
    />
  );

  if (!raised) return icon;

  // AI Chat 中间凸起按钮
  return (
    <View
      style={[
        styles.raised,
        focused && { backgroundColor: colors.ochre },
        !focused && { backgroundColor: colors.vermilion },
      ]}
    >
      {icon}
    </View>
  );
}

function TabNavigator() {
  // 导航容器随窗口宽度切换（DESIGN.md §4.3）：
  // compact 底部 Tab bar / medium·expanded 左侧 rail(80) / large 常驻侧边栏(280)。
  const { navKind, navWidth, isShort } = useLayout();
  const vertical = navKind !== "tabs";

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        headerTitleAlign: "center",
        headerStyle: styles.header,
        headerTitleStyle: styles.headerTitle,
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.vermilion,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarPosition: vertical ? "left" : "bottom",
        tabBarVariant: vertical ? "material" : "uikit",
        tabBarLabelPosition:
          navKind === "sidebar" ? "beside-icon" : "below-icon",
        // 矮窗口（手机横屏 / 桌面矮窗）只留图标，把纵向空间还给正文。
        tabBarShowLabel: !(navKind === "tabs" && isShort),
        tabBarStyle: vertical
          ? [styles.rail, { width: navWidth }]
          : styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => {
          const meta = TAB_ICONS[route.name as keyof TabParamList];
          return (
            <TabBarIcon
              name={focused ? meta.active : meta.inactive}
              focused={focused}
              // 凸起中央按钮只存在于 compact 的底部 Tab；
              // rail / 侧边栏里「探索」退化为普通高亮项（保留强调色）。
              raised={!vertical && route.name === "AiChat"}
            />
          );
        },
      })}
    >
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ title: "分类" }}
      />
      <Tab.Screen
        name="Bookshelf"
        component={BookshelfScreen}
        options={{ title: "书架" }}
      />
      <Tab.Screen
        name="AiChat"
        component={AiChatScreen}
        options={{ title: "探索", tabBarLabel: "探索" }}
      />
      <Tab.Screen
        name="Tools"
        component={ToolsScreen}
        options={{ title: "工具" }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "我" }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: styles.header,
          headerTitleStyle: styles.headerTitle,
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.paper },
        }}
      >
        <Stack.Screen
          name="Tabs"
          component={TabNavigator}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CategoryBrowse"
          component={CategoryBrowseScreen}
          options={({ route }) => ({
            title: route.params.breadcrumb[route.params.breadcrumb.length - 1] ?? "目录",
          })}
        />
        <Stack.Screen
          name="ChapterList"
          component={ChapterListScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen
          name="BookChannels"
          component={BookChannelsScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="NewChat"
          component={NewChatScreen}
          options={{ title: "新对话" }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: "设置" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.paperRaised,
  },
  headerTitle: {
    color: colors.ink,
    fontWeight: "600",
  },
  tabBar: {
    backgroundColor: colors.paperRaised,
    borderTopColor: colors.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 58,
    paddingBottom: 4,
    paddingTop: 4,
  },
  tabLabel: {
    fontSize: 11,
  },
  rail: {
    backgroundColor: colors.paperRaised,
    borderRightColor: colors.hairline,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  raised: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -18,
    borderWidth: 3,
    borderColor: colors.paperRaised,
    shadowColor: "#8a7a5a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
