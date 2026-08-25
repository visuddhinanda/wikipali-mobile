import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CopilotKitProvider } from '@copilotkit/react-native';
import { RootNavigator } from './src/navigation/RootNavigator';

// Runtime 地址：EXPO_PUBLIC_* 会在 `npx expo start` 时从 .env 内联进 bundle。
// 真机（development build，本项目不能用 Expo Go）必须用电脑的局域网 IP，不能用 localhost。
const runtimeUrl =
  process.env.EXPO_PUBLIC_RUNTIME_URL || 'http://localhost:3001/api/copilotkit';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CopilotKitProvider runtimeUrl={runtimeUrl}>
          <RootNavigator />
          <StatusBar style="dark" />
        </CopilotKitProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
