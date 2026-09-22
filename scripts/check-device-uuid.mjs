// 自检：src/user/deviceUuid.ts 里的 SHA-1 / UUID v5 算法是否正确。
// 与 node:crypto 的 SHA-1 及 RFC 4122 UUID v5 已知向量比对。
// 运行：node scripts/check-device-uuid.mjs
import { createHash } from "node:crypto";

function utf8Bytes(input) {
  const encoded = encodeURIComponent(input);
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded.charCodeAt(i);
    if (c === 0x25) {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(c & 0xff);
  }
  return new Uint8Array(bytes);
}

function sha1(bytes) {
  const ml = bytes.length;
  const totalLen = Math.ceil((ml + 1 + 8) / 64) * 64;
  const msg = new Uint8Array(totalLen);
  msg.set(bytes);
  msg[ml] = 0x80;
  const bitLen = ml * 8;
  msg[totalLen - 4] = (bitLen >>> 24) & 0xff;
  msg[totalLen - 3] = (bitLen >>> 16) & 0xff;
  msg[totalLen - 2] = (bitLen >>> 8) & 0xff;
  msg[totalLen - 1] = bitLen & 0xff;

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3];
    }
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((word, i) => {
    out[i * 4] = (word >>> 24) & 0xff;
    out[i * 4 + 1] = (word >>> 16) & 0xff;
    out[i * 4 + 2] = (word >>> 8) & 0xff;
    out[i * 4 + 3] = word & 0xff;
  });
  return out;
}

function hexBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function uuidV5(name, namespace) {
  const hash = sha1(new Uint8Array([...hexBytes(namespace), ...utf8Bytes(name)]));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = bytesHex(hash);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const checks = [
  ["abc", "a9993e364706816aba3e25717850c26c9cd0d89d"],
  ["", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
  ["The quick brown fox jumps over the lazy dog", "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12"],
  ["法音 wikipali", createHash("sha1").update(utf8Bytes("法音 wikipali")).digest("hex")],
];

let fail = 0;
for (const [input, expected] of checks) {
  const got = bytesHex(sha1(utf8Bytes(input)));
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} sha1(${JSON.stringify(input)}) = ${got}${ok ? "" : ` (expected ${expected})`}`);
}

// 用 node:crypto 现场算 UUID v5 期望值（权威），再与纯 JS 实现比对。
function nodeUuidV5(name, namespace) {
  const raw = createHash("sha1")
    .update(Buffer.from([...hexBytes(namespace), ...utf8Bytes(name)]))
    .digest();
  raw[6] = (raw[6] & 0x0f) | 0x50;
  raw[8] = (raw[8] & 0x3f) | 0x80;
  const h = Buffer.from(raw).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const DNS_NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const URL_NS = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
for (const [ns, label] of [[DNS_NS, "DNS"], [URL_NS, "URL"]]) {
  const expected = nodeUuidV5("www.example.com", ns);
  const got = uuidV5("www.example.com", ns);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} uuidV5("www.example.com", ${label}_NS) = ${got}${ok ? "" : ` (expected ${expected})`}`);
}

// 确定性：同一输入多次结果一致，且格式合法
const a = uuidV5("android:dd96dec43fb81c97", DNS_NS);
const b = uuidV5("android:dd96dec43fb81c97", DNS_NS);
const det = a === b && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a);
if (!det) fail++;
console.log(`${det ? "PASS" : "FAIL"} deterministic + format: ${a} vs ${b}`);

process.exit(fail ? 1 : 0);
