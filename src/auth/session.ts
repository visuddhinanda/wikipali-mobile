/**
 * 登录会话持久化。
 *
 * token 是鉴权凭证，放系统钥匙串（iOS Keychain / Android Keystore，
 * 经 `expo-secure-store`），不落明文；用户信息（昵称、头像）只是首屏
 * 免闪烁的缓存，不敏感且可能超出 SecureStore 的容量建议，仍放 AsyncStorage。
 *
 * Web（`expo start --web`）上 SecureStore 不可用，此时降级为 AsyncStorage，
 * 与浏览器端 localStorage 的安全级别相当。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/** SecureStore 的 key 只允许字母数字与 `.`、`-`、`_`，不能用 `@`、`/`。 */
const TOKEN_KEY = "wikipali_token";
/** 迁移用：0.x 版本曾把 token 明文存在 AsyncStorage 的这个键下。 */
const LEGACY_TOKEN_KEY = "@wikipali/token";
const USER_KEY = "@wikipali/current-user";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  // 重启后首次解锁即可读取，之后即便锁屏也能续期，够用且不会太弱。
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** 后端 `/api/v2/auth/current` 返回的用户信息。 */
export interface AuthUser {
  id: string;
  nickName: string;
  realName: string;
  avatar: string;
  roles: string[] | null;
}

/** 内存副本：避免每次发请求都 await 一次存储。 */
let cachedToken: string | null = null;

let secureAvailable: boolean | null = null;

async function canUseSecureStore(): Promise<boolean> {
  if (secureAvailable === null) {
    try {
      secureAvailable = await SecureStore.isAvailableAsync();
    } catch {
      secureAvailable = false;
    }
  }
  return secureAvailable;
}

export async function loadToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    if (await canUseSecureStore()) {
      cachedToken = await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTIONS);
      if (!cachedToken) {
        // 旧版本留下的明文 token：搬进钥匙串后删除原件。
        const legacy = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
        if (legacy) {
          await SecureStore.setItemAsync(TOKEN_KEY, legacy, SECURE_OPTIONS);
          await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
          cachedToken = legacy;
        }
      }
    } else {
      cachedToken = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
    }
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** 同步读取内存副本（`loadToken` 之后才有值）。 */
export function getTokenSync(): string | null {
  return cachedToken;
}

export async function saveToken(token: string): Promise<void> {
  cachedToken = token;
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_OPTIONS);
  } else {
    await AsyncStorage.setItem(LEGACY_TOKEN_KEY, token);
  }
}

export async function clearSession(): Promise<void> {
  cachedToken = null;
  if (await canUseSecureStore()) {
    await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTIONS);
  }
  await AsyncStorage.multiRemove([LEGACY_TOKEN_KEY, USER_KEY]);
}

export async function loadUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export async function saveUser(user: AuthUser): Promise<void> {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}
