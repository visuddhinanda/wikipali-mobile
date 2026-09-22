/**
 * 设备确定性 UUID（游客身份）。
 *
 * 目标：同一台设备无论计算多少次都得到同一个 uuid；不同设备不重复。
 * 做法：取「设备 id」（Android ANDROID_ID / iOS IDFV）→ 用 SHA-1 做 UUID v5
 * （固定 namespace）折叠成标准 `8-4-4-4-12` 格式。
 *
 * - `expo-application` 是 `expo-notifications`（直接依赖）的传递依赖，其原生模块
 *   已编进现有 dev-client，**无需重建 APK**。
 * - 取不到设备 id（Web / 异常）时，生成随机 uuid 持久化到 SecureStore 兜底。
 *
 * 设计细节见 `docs/multi-user-sync.md` §3。
 */
import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";

/** 项目自留的 namespace（固定即可，保证「同一输入 → 同一输出」）。 */
const DEVICE_NS = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/** 兜底 uuid 的存储 key。 */
const FALLBACK_KEY = "wikipali_device_uuid";

let cached: Promise<string> | null = null;

/** UTF-8 编码字符串为字节。 */
function utf8Bytes(input: string): Uint8Array {
  const encoded = encodeURIComponent(input);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded.charCodeAt(i);
    if (c === 0x25 /* % */) {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** 纯 JS SHA-1（RFC 3174）。输入字节 → 20 字节摘要。 */
export function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length;
  const withOne = ml + 1;
  const totalLen = Math.ceil((withOne + 8) / 64) * 64;
  const msg = new Uint8Array(totalLen);
  msg.set(bytes);
  msg[ml] = 0x80;

  // 原始消息位数（64-bit big-endian）。设备 id 字符串远小于 2^29 字节，
  // 高位恒为 0，低位用 * 8（< 2^32）即可，无需 BigInt。
  const bitLen = ml * 8;
  msg[totalLen - 4] = (bitLen >>> 24) & 0xff;
  msg[totalLen - 3] = (bitLen >>> 16) & 0xff;
  msg[totalLen - 2] = (bitLen >>> 8) & 0xff;
  msg[totalLen - 1] = bitLen & 0xff;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        (msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3];
    }
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const words = [h0, h1, h2, h3, h4];
  for (let i = 0; i < 5; i++) {
    out[i * 4] = (words[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 3] = words[i] & 0xff;
  }
  return out;
}

/** 十六进制字符串 → 字节。 */
function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 字节 → 十六进制小写字符串。 */
function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 用 SHA-1 从字符串派生出 UUID v5（RFC 4122）。 */
export function uuidV5(name: string, namespace: string = DEVICE_NS): string {
  const hash = sha1(new Uint8Array([...hexBytes(namespace), ...utf8Bytes(name)]));
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytesHex(hash);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20, 32),
  ].join("-");
}

/** 原始设备 id。 */
async function deviceId(): Promise<string> {
  try {
    if (Application.getAndroidId) {
      const id = Application.getAndroidId();
      if (id) return `android:${id}`;
    }
  } catch {
    /* 继续尝试 iOS / 兜底 */
  }
  try {
    if (Application.getIosIdForVendorAsync) {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return `ios:${id}`;
    }
  } catch {
    /* 继续兜底 */
  }
  return "";
}

/** 兜底：取 SecureStore 里的 uuid，没有则生成一个（crypto 由 index.ts 的 polyfill 提供）。 */
async function fallbackUuid(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(FALLBACK_KEY);
    if (existing) return existing;
  } catch {
    /* 读不到就生成 */
  }
  let uuid: string;
  try {
    uuid = crypto.randomUUID();
  } catch {
    // 极端情况连 crypto 都没有：用时间 + 随机数凑一个（仅 Web 极老环境兜底）。
    uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
  try {
    await SecureStore.setItemAsync(FALLBACK_KEY, uuid);
  } catch {
    /* 存不上也不影响本次运行 */
  }
  return uuid;
}

/**
 * 游客设备 uuid：同一设备永远同一值；取不到设备 id 时回退到持久化随机 uuid。
 * 结果缓存到 Promise，进程内只算一次。
 */
export function getDeviceUuid(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const id = await deviceId();
      return id ? uuidV5(id) : fallbackUuid();
    })().catch((err) => {
      cached = null; // 失败不缓存，下次重试
      throw err;
    });
  }
  return cached;
}
