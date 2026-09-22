<div align="center">

# Wikipali Mobile · 法音

**A mobile app for reading the Pāli Tipiṭaka on Android and iOS** —— browse the
canon, compare translations side by side, and ask an AI that answers with citations

Built on the [WikiPali](https://www.wikipali.org) corpus · Expo SDK 57 · React Native 0.86 · TypeScript

**English** · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-57-blue.svg)](https://docs.expo.dev/versions/v57.0.0/)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61dafb.svg)](https://reactnative.dev)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20iOS-3ddc84.svg)](docs/development.md#4-run-modes)

</div>

---

Wikipali Mobile (**法音**) is the phone client for [wikipali.org](https://www.wikipali.org):
the Pāli canon, its translations in several languages, and an AI study assistant,
in your pocket. It is a React Native app built with Expo — one codebase, one
Android and iOS app. This repository contains that app; the corpus and the API it
reads live in the [mint](https://github.com/iapt-platform/mint) backend.

## Quick start

```bash
git clone <repo-url> wikipali-mobile
cd wikipali-mobile
npm install               # postinstall applies the patches in patches/ — do not skip
cp .env.example .env
npx expo start --lan
```

Open the development build on the phone and connect to `http://<computer-ip>:8081`.
With an empty `.env` the app reads from the public `next.wikipali.org` server —
nothing else to configure.

> [!IMPORTANT]
> **Expo Go cannot run this app.** It depends on native modules that the prebuilt
> Expo Go runtime does not contain, so you must install a **development build**
> APK once — see [First run](#first-run-installing-the-development-build) below
> ([why](docs/troubleshooting.md#expo-go-crashes)).

> [!NOTE]
> The patches in [`patches/`](patches) are required —
> [what they fix](docs/troubleshooting.md#patched-dependencies).

## Features

| Area | What it does |
|---|---|
| **Canon browsing** | Sutta / Vinaya / Abhidhamma category tree down to chapters, bundled offline so the tree opens without a network |
| **Versions & translations** | Per-chapter channel list grouped by type, with a progress ring and last-updated time per version |
| **Reader** | HTML reading view with a chapter drawer and adjustable reading settings |
| **Explore (AI)** | Streaming Q&A over the corpus via a CopilotKit agent, with tool-call status and citations that jump into the reader |
| **Bookshelf** | Local reading history, merged per book, with progress |
| **Settings** | Switch between WikiPali API servers at runtime |

## First run: installing the development build

You need this once per device; afterwards Metro serves every JS/TS change live.

1. **Requirements** — Node.js ≥ 20.19, npm 10+, an Android device/emulator or an
   iOS device/Simulator, and a free [Expo account](https://expo.dev/signup)
   ([what Expo is and why an account is needed](docs/development.md#do-i-need-an-expo-account)).

2. **One-time Expo setup** — sign up, then `eas login` and `eas init` to point the
   project at your own EAS project. Full walkthrough:
   [One-time setup](docs/development.md#one-time-setup).

3. **Build and install it:**

   ```bash
   eas build -p android --profile development
   eas build -p ios --profile development       # see the iOS notes below
   ```

   The CLI prints a build page with a QR code; open it on the phone and install.

   iOS on a **physical device** additionally needs a paid Apple Developer account
   and the device registered with `eas device:create`; the **Simulator** needs
   neither, but does need a simulator build profile —
   [iOS builds](docs/development.md#ios-builds).

> [!TIP]
> Rebuild only when a **native** dependency or native config changes —
> [rebuild rules](docs/development.md#when-do-i-need-to-rebuild-the-apk).
> Don't want an Expo account? Build locally with Android Studio or Xcode instead:
> [`npx expo run:android` / `run:ios`](docs/development.md#building-without-an-expo-account).

## Run modes

| Mode | What you get | Setup |
|---|---|---|
| **Device + public API** | Full reading experience against `next.wikipali.org`; AI tab offline | Nothing — works with an empty `.env` |
| **Device + local AI stack** | Adds streaming AI Q&A | Run the `agent-poc` services, point `EXPO_PUBLIC_RUNTIME_URL` at your LAN IP |
| **Android emulator** | Same APK via `adb install` | Use `10.0.2.2` instead of the LAN IP |
| **Waydroid** | Same app in an Android container on a Linux desktop | `waydroid app install` the APK, connect to the host LAN IP (not `10.0.2.2`) — [setup](docs/development.md#6-waydroid-android-on-a-linux-desktop) |
| **iOS device / Simulator** | Same app on iOS | The Simulator shares the host network, so `localhost` works as-is |

Web is not a supported target. Step-by-step for every mode:
[Development Guide → Run modes](docs/development.md#4-run-modes).

<details>
<summary><b>Configuration (both variables are optional)</b></summary>

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_RUNTIME_URL` | CopilotKit runtime endpoint for the AI tab |
| `EXPO_PUBLIC_API_URL` | Override the content API base URL |

With an empty `.env` the app uses the server chosen in **Me → Settings → API
server** (default `next.wikipali.org`).

On a device `localhost` points at the phone itself — always use your computer's
LAN IP, and restart `expo start` after editing `.env`, because `EXPO_PUBLIC_*`
values are inlined at bundle time.
</details>

## Repository layout

```
index.ts           polyfill imports (order is mandatory) → App
App.tsx            GestureHandler → SafeArea → CopilotKit → RootNavigator
metro.config.js    jose / node:* resolver fix
src/               api · catalog · components · navigation · screens · settings · theme
patches/           required patch-package patches
docs/              development guide and troubleshooting
```

## Documentation

| Document | Contents |
|---|---|
| [Development Guide](docs/development.md) | Prerequisites, configuration, run modes, EAS builds, Waydroid, project layout |
| [Commentary layers](docs/commentary-layers.md) | How a chapter's commentary layer is resolved and its counterparts found |
| [Troubleshooting](docs/troubleshooting.md) | Expo Go, Metro/jose, polyfill order, patches, file-watcher limits, networking |
| [docs/README.md](docs/README.md) | Product and architecture design entry (Chinese) |
| [docs/multi-user-sync.md](docs/multi-user-sync.md) | Multi-user & data sync design (Chinese) |
| [docs/chat.md](docs/chat.md) | AI explore/chat design (Chinese) |
| [STATUS.md](STATUS.md) | Running progress log (Chinese) |

## Related links

- [WikiPali](https://www.wikipali.org) —— the corpus this app reads
- [iapt-platform/mint](https://github.com/iapt-platform/mint) —— the Laravel backend API
- [Expo SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/)

## License

[MIT](LICENSE) © visuddhinanda
