import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CopilotKitProvider } from '@copilotkit/react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider } from './src/auth/AuthContext';
import { I18nProvider } from './src/i18n/I18nContext';
import { useUposathaNotifications } from './src/calendar/useUposathaNotifications';

// Runtime 地址：EXPO_PUBLIC_* 会在 `npx expo start` 时从 .env 内联进 bundle。
// 真机（development build，本项目不能用 Expo Go）必须用电脑的局域网 IP，不能用 localhost。
const runtimeUrl =
  process.env.EXPO_PUBLIC_RUNTIME_URL || 'http://localhost:3001/api/copilotkit';

/**
 * 布萨日通知的重排要在 I18nProvider **之内**（要拿 t 与 locale 写通知文案），
 * 所以单独包一层，不能直接写在 App 里。它不渲染任何东西。
 */
function UposathaNotifications() {
  useUposathaNotifications();
  return null;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CopilotKitProvider runtimeUrl={runtimeUrl}>
          <I18nProvider>
            <UposathaNotifications />
            <AuthProvider>
              <RootNavigator />
            </AuthProvider>
          </I18nProvider>
          <StatusBar style="dark" />
        </CopilotKitProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
