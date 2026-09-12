/**
 * 有没有网。
 *
 * 用 `expo-network` 的 `getNetworkStateAsync`：既看「连没连上网络」（WiFi/蜂窝），
 * 也看「能不能真访问互联网」（`isInternetReachable`，比如连了个没外网的路由器）。
 */
import * as Network from "expo-network";

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected) return false;
    // `isInternetReachable` 偶发为 undefined（无法判定）；未知不当作离线，
    // 交给后续调用自身的超时兜底，避免误判成「没网」。
    return state.isInternetReachable !== false;
  } catch {
    return false;
  }
}
