# Troubleshooting

Known issues, why they happen, and what is already done about them.
Setup steps live in the [Development Guide](./development.md).

## Expo Go crashes

**Symptom:** the app crashes as soon as a markdown answer renders, with
`... not found in ViewManagerRegistry`.

**Cause:** the project depends on modules that ship native Android/iOS/C++ code
and are not part of the prebuilt Expo Go runtime.

**Fix:** use a development build (`expo-dev-client`), never Expo Go. See
[Development Guide → Building the development client](./development.md#5-building-the-development-client).

## `Unable to resolve module node:buffer`

**Symptom:** Metro fails to bundle.

**Cause:** `jose` reaches the bundle transitively
(`@copilotkit/shared` → `@segment/analytics-node` → `jose`) and imports Node
built-ins that Hermes cannot bundle.

**Fix:** already handled in [`metro.config.js`](../metro.config.js) with the
official `resolveRequest` workaround that forces `jose` onto its browser build.
Do not delete it, and do not set `unstable_conditionNames` globally — that would
affect every dual-build dependency.

## Polyfill import order

[`index.ts`](../index.ts) must import, in this exact order:

1. `react-native-get-random-values` — the secure random source has to win the
   race for `crypto.getRandomValues`; otherwise CopilotKit locks onto a
   non-cryptographic fallback.
2. `@copilotkit/react-native/polyfills` — before any other CopilotKit import.

Do not reorder or move these below other imports.

## Patched dependencies

`npm install` runs `patch-package` via `postinstall`. Two patches in
[`patches/`](../patches) are required:

| Patch | Why |
|---|---|
| `@copilotkit/react-native` | raises the 60s request timeout to 10 min — long tool-calling runs otherwise fail with `Network request failed` |
| `react-native-streamdown` | fixes a conflict with worklets 0.10.x that crashed the renderer |

If you install with `--ignore-scripts`, run `npx patch-package` manually.

## Metro does not pick up code changes / `ENOSPC: System limit for number of file watchers`

**Symptom:** editing JS/TS triggers no rebuild and the device keeps serving the
old bundle, or `expo start --clear` crashes outright.

**Cause:** without watchman Metro falls back to Node's `fs.watch` per directory;
`node_modules` has thousands of directories and blows through the inotify limit.

**Fix:** start Metro in CI mode:

```bash
CI=1 npx expo start --lan
```

Trade-off: CI mode disables watching, so the file map is built once and cached —
**restart `expo start` after every code change** and reload on the device. There
is no Fast Refresh in this mode. Alternatively, raise the host limit
(`fs.inotify.max_user_watches`) or install watchman.

## The phone cannot reach the dev server

- Phone and computer must be on the same WiFi.
- Open **3001** (runtime) and **8081** (Metro) in the host firewall.
- Never use `localhost`/`127.0.0.1` in `.env` — on the device that points at the
  phone itself. Use the computer's LAN IP (emulator: `10.0.2.2`).
- Verify from the phone's browser: `http://<computer-ip>:3001/api/copilotkit/info`.
- Restart `expo start` after changing `.env`; `EXPO_PUBLIC_*` is inlined at
  bundle time.

## Peer dependencies for CopilotKit's prebuilt chat

`@copilotkit/react-native/components` needs its peers installed alongside the
root entry (`@gorhom/bottom-sheet`, `expo-document-picker`, `expo-file-system`,
…). Install them with `npx expo install` so versions stay SDK-compatible.

## Sandboxed / restricted home directory

Expo and EAS write to `~/.expo` and `~/.config`. Where that is not writable,
redirect them into the project:

```bash
export __UNSAFE_EXPO_HOME_DIRECTORY="$PWD/.expo-home"
export XDG_CONFIG_HOME="$PWD/.eas-config"
```

Both paths are already git-ignored.
