import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  DefaultTheme,
  getFocusedRouteNameFromRoute,
  NavigationContainer,
  useNavigation,
  type Theme,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
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
import { ensureAiAvailable } from "../ai/availability";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { LanguageSettingsScreen } from "../screens/LanguageSettingsScreen";
import { ApiServerSettingsScreen } from "../screens/ApiServerSettingsScreen";
import { AboutScreen } from "../screens/AboutScreen";
import { DebugLayoutScreen } from "../screens/DebugLayoutScreen";
import { ScriptConvertorScreen } from "../screens/ScriptConvertorScreen";
import { CalendarScreen } from "../screens/CalendarScreen";
import { CalendarDayScreen } from "../screens/CalendarDayScreen";
import { CalendarLocationScreen } from "../screens/CalendarLocationScreen";
import { CalendarSystemScreen } from "../screens/CalendarSystemScreen";
import { FlightSunScreen } from "../screens/FlightSunScreen";
import { ScanScreen } from "../screens/ScanScreen";
import { ChannelListScreen } from "../screens/ChannelListScreen";
import { ChannelDetailScreen } from "../screens/ChannelDetailScreen";
import { navigationRef } from "../linking/handler";
import { useDeepLinks } from "../linking/useDeepLinks";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";

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
  { active: IoniconName; inactive: IoniconName; label: MessageKey }
> = {
  Discover: { active: "grid", inactive: "grid-outline", label: "nav.discover" },
  Bookshelf: {
    active: "book",
    inactive: "book-outline",
    label: "nav.bookshelf",
  },
  AiChat: {
    active: "chatbubble-ellipses",
    inactive: "chatbubble-ellipses-outline",
    label: "nav.aiChat",
  },
  Tools: { active: "apps", inactive: "apps-outline", label: "nav.tools" },
  Profile: {
    active: "person",
    inactive: "person-outline",
    label: "nav.profile",
  },
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
      color={
        raised
          ? colors.paperRaised
          : focused
            ? colors.vermilion
            : colors.inkFaint
      }
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

/**
 * 每个 Tab 内部各自的 Stack。
 *
 * 下钻页面（分类 → 章节 → 版本 → 阅读器）必须放在 Tab **内部**的 Stack 里，
 * 否则最外层 Stack 会整屏盖住导航容器 —— 宽屏下 rail / 侧边栏会在下钻时消失，
 * 与 `docs/README.md` §4.3「导航容器常驻」相悖。
 */
// 用函数返回：`styles` 在模块尾部声明，模块顶层直接取值会命中 TDZ。
const stackScreenOptions = () => ({
  headerStyle: styles.header,
  headerTitleStyle: styles.headerTitle,
  headerTintColor: colors.ink,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: "minimal" as const,
  contentStyle: { backgroundColor: colors.paper },
});

/** 「书架」标题栏右侧的批量下载入口。 */
function BatchDownloadButton() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => navigation.navigate("ChannelList")}
      style={({ pressed }) => [
        styles.headerButton,
        pressed && { opacity: 0.5 },
      ]}
    >
      <Ionicons name="add" size={24} color={colors.ink} />
    </Pressable>
  );
}

/** 「分类」标题栏右侧的扫码入口。 */
function ScanButton() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => navigation.navigate("Scan")}
      style={({ pressed }) => [
        styles.headerButton,
        pressed && { opacity: 0.5 },
      ]}
    >
      <Ionicons name="scan-outline" size={22} color={colors.ink} />
    </Pressable>
  );
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** 阅读链路：分类树 → 章节 → 版本 → 阅读器。多个 Tab 复用。 */
function readingChainScreens(t: T) {
  return (
    <>
      <Stack.Screen
        name="CategoryBrowse"
        component={CategoryBrowseScreen}
        options={({ route }) => ({
          title:
            route.params.breadcrumb[route.params.breadcrumb.length - 1] ??
            t("nav.catalog"),
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
        name="ChannelList"
        component={ChannelListScreen}
        options={{ title: t("channelList.title") }}
      />
      <Stack.Screen
        name="ChannelDetail"
        component={ChannelDetailScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
      <Stack.Screen
        name="NewChat"
        component={NewChatScreen}
        options={{ title: t("nav.newChat") }}
      />
    </>
  );
}

function BrowseStack() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions()}>
      <Stack.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{
          title: t("nav.discover"),
          headerRight: () => <ScanButton />,
        }}
      />
      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={{ title: t("scan.title") }}
      />
      {readingChainScreens(t)}
    </Stack.Navigator>
  );
}

function BookshelfStack() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions()}>
      <Stack.Screen
        name="Bookshelf"
        component={BookshelfScreen}
        options={{
          title: t("nav.bookshelf"),
          headerRight: () => <BatchDownloadButton />,
        }}
      />
      {readingChainScreens(t)}
    </Stack.Navigator>
  );
}

function ChatStack() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions()}>
      <Stack.Screen
        name="AiChat"
        component={AiChatScreen}
        options={{ title: t("nav.aiChat") }}
      />
      {readingChainScreens(t)}
    </Stack.Navigator>
  );
}

function ToolsStack() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions()}>
      <Stack.Screen
        name="Tools"
        component={ToolsScreen}
        options={{ title: t("nav.tools") }}
      />
      <Stack.Screen
        name="ScriptConvertor"
        component={ScriptConvertorScreen}
        options={{ title: t("tools.script.title") }}
      />
      <Stack.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ title: t("calendar.title") }}
      />
      <Stack.Screen
        name="CalendarDay"
        component={CalendarDayScreen}
        options={({ route }) => ({
          title: `${route.params.year}-${String(route.params.month).padStart(2, "0")}-${String(route.params.day).padStart(2, "0")}`,
        })}
      />
      <Stack.Screen
        name="CalendarLocation"
        component={CalendarLocationScreen}
        options={{ title: t("calendar.location.title") }}
      />
      <Stack.Screen
        name="CalendarSystem"
        component={CalendarSystemScreen}
        options={{ title: t("calendar.systemTitle") }}
      />
      <Stack.Screen
        name="FlightSun"
        component={FlightSunScreen}
        options={{ title: t("calendar.flight.title") }}
      />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions()}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: t("nav.profile") }}
      />
      <Stack.Screen
        name="ChannelList"
        component={ChannelListScreen}
        options={{ title: t("channelList.title") }}
      />
      <Stack.Screen
        name="ChannelDetail"
        component={ChannelDetailScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
      <Stack.Screen
        name="NewChat"
        component={NewChatScreen}
        options={{ title: t("nav.newChat") }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t("nav.settings") }}
      />
      <Stack.Screen
        name="LanguageSettings"
        component={LanguageSettingsScreen}
        options={{ title: t("settings.language") }}
      />
      <Stack.Screen
        name="ApiServerSettings"
        component={ApiServerSettingsScreen}
        options={{ title: t("settings.apiServer") }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{ title: t("settings.about") }}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ title: t("nav.signIn") }}
      />
      {__DEV__ ? (
        <Stack.Screen
          name="DebugLayout"
          component={DebugLayoutScreen}
          options={{ title: t("nav.debugLayout") }}
        />
      ) : null}
    </Stack.Navigator>
  );
}

const TAB_STACKS: Record<keyof TabParamList, React.ComponentType> = {
  Discover: BrowseStack,
  Bookshelf: BookshelfStack,
  AiChat: ChatStack,
  Tools: ToolsStack,
  Profile: ProfileStack,
};

export function RootNavigator() {
  // 导航容器随窗口宽度切换（docs/README.md §4.3）：
  // compact 底部 Tab bar / medium·expanded 左侧 rail(80) / large 常驻侧边栏(280)。
  const { navKind, navWidth, isShort } = useLayout();
  const t = useT();
  // 导航容器就绪后才能处理冷启动带进来的链接。
  const [navReady, setNavReady] = React.useState(false);
  useDeepLinks(navReady);
  const vertical = navKind !== "tabs";

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={() => setNavReady(true)}
    >
      <Tab.Navigator
        screenOptions={({ route }) => {
          // 阅读器与聊天对话页都是全屏沉浸页：进入后隐藏 App 自身的导航容器
          // （底部 Tab / 左侧 rail / 侧边栏）。阅读器把底部让给经文导航，
          // 聊天对话页则让对话占据整个屏幕。
          const focused = getFocusedRouteNameFromRoute(route) ?? route.name;
          const immersive = focused === "Reader" || focused === "NewChat";
          return {
            // 头部由各 Tab 内部的 Stack 负责，避免双层标题栏
            headerShown: false,
            tabBarActiveTintColor: colors.vermilion,
            tabBarInactiveTintColor: colors.inkFaint,
            tabBarPosition: vertical ? "left" : "bottom",
            tabBarVariant: vertical ? "material" : "uikit",
            tabBarLabelPosition:
              navKind === "sidebar" ? "beside-icon" : "below-icon",
            // 矮窗口（手机横屏 / 桌面矮窗）只留图标，把纵向空间还给正文。
            tabBarShowLabel: !(navKind === "tabs" && isShort),
            tabBarStyle: immersive
              ? { display: "none" }
              : vertical
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
          };
        }}
      >
        {(Object.keys(TAB_STACKS) as (keyof TabParamList)[]).map((name) => (
          <Tab.Screen
            key={name}
            name={name}
            component={TAB_STACKS[name]}
            options={{ title: t(TAB_ICONS[name].label) }}
            // 「探索」整个 Tab 依赖 CopilotKit Runtime，服务没上线就先别放人进去。
            listeners={
              name === "AiChat"
                ? ({ navigation: nav }) => ({
                    tabPress: (e) => {
                      e.preventDefault();
                      void ensureAiAvailable(t).then((ok) => {
                        if (ok) nav.navigate("AiChat");
                      });
                    },
                  })
                : undefined
            }
          />
        ))}
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.paperRaised,
  },
  headerButton: {
    paddingHorizontal: 4,
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
