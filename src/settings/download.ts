/**
 * 下载设置（持久化到 AsyncStorage，见 `docs/download-manager.md` §8.4 / §8.5）。
 *
 * - `cellularAllowed`「使用移动网络下载」：默认**关** = 仅 Wi‑Fi；关时在移动网络下
 *   点下载会先询问（立即下载 / 等待 Wi‑Fi / 取消）。
 * - `autoOnWifi`「连上 Wi‑Fi 时自动下载」：默认开；关时等 Wi‑Fi 的书连上后停在
 *   「已连上 Wi‑Fi，点开始」。目前只在 App 在前台时生效。
 *
 * 按设备存、不随账号同步（网络习惯是设备属性）。内存里留一份，下载调度器同步读取。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@wikipali/download-settings";

export interface DownloadSettings {
  cellularAllowed: boolean;
  autoOnWifi: boolean;
}

const DEFAULTS: DownloadSettings = { cellularAllowed: false, autoOnWifi: true };

let current: DownloadSettings = { ...DEFAULTS };
let loaded: Promise<DownloadSettings> | null = null;
const listeners = new Set<(s: DownloadSettings) => void>();

/** 读设置（首次从存储加载，之后走内存）。总是返回**当前**值，不是首次加载时那份。 */
export function loadDownloadSettings(): Promise<DownloadSettings> {
  loaded ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DownloadSettings>) };
      return current;
    })
    .catch(() => current);
  return loaded.then(() => current);
}

/** 同步读当前值（未加载完时是默认值）。 */
export function getDownloadSettings(): DownloadSettings {
  return current;
}

export async function setDownloadSettings(
  patch: Partial<DownloadSettings>,
): Promise<void> {
  await loadDownloadSettings();
  current = { ...current, ...patch };
  for (const fn of listeners) fn(current);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 存不进去只影响下次启动，本次已生效。
  }
}

export function onDownloadSettingsChange(
  fn: (s: DownloadSettings) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
