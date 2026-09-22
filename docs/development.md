# Development Guide

Everything you need to get the app running, in every supported environment.
For the "what is this" overview see the [README](../README.md); for errors see
[Troubleshooting](./troubleshooting.md).

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 20.19 (22/24 recommended) | Expo SDK 57 requirement |
| npm 10+ | the repo ships a `package-lock.json` |
| An Android device/emulator, or an iOS device/simulator | Android and iOS are both supported |
| macOS + Xcode (iOS only) | needed for the iOS Simulator and for local iOS builds |
| A free [Expo account](https://expo.dev/signup) | needed to build the app — [why](#do-i-need-an-expo-account); [alternative without one](#building-without-an-expo-account) |

> **Expo Go does not work.** The app pulls in native modules (gesture-handler,
> reanimated, webview, markdown renderer) that are not part of the Expo Go
> runtime. A **development build** (`expo-dev-client`) is mandatory —
> see [Troubleshooting → Expo Go](./troubleshooting.md#expo-go-crashes).

## 2. Install

```bash
git clone <repo-url> wikipali-mobile
cd wikipali-mobile
npm install          # runs patch-package via postinstall — do not skip
cp .env.example .env
```

`npm install` applies the patches in [`patches/`](../patches). They are required;
see [Troubleshooting](./troubleshooting.md#patched-dependencies).

## 3. Configuration

All runtime configuration is optional — with an empty `.env` the app talks to the
public API server and falls back to bundled mock data.

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_RUNTIME_URL` | `http://localhost:3001/api/copilotkit` | CopilotKit runtime for the AI tab |
| `EXPO_PUBLIC_API_URL` | unset | Overrides the content API base (e.g. `http://192.168.1.10:4000/api/v2`) |

When `EXPO_PUBLIC_API_URL` is unset the base URL comes from the in-app picker
(**Me → Settings → API server**), which defaults to `next.wikipali.org`
(`src/settings/server.ts`).

> On a physical device `localhost` means *the phone*. Always use the LAN IP of
> your computer (`ip addr` / `ifconfig` / `ipconfig`), and restart
> `expo start` after editing `.env` — `EXPO_PUBLIC_*` values are inlined at
> bundle time.

## 4. Run modes

### Mode A — Device + public API (no local backend)

The quickest way in. Browsing, chapter lists, versions and the reader all work
against `next.wikipali.org`; the AI tab stays offline.

```bash
npx expo start --lan       # add CI=1 if Metro hits the watcher limit (see troubleshooting)
```

Open the installed development build on the phone and enter
`http://<computer-ip>:8081`.

### Mode B — Device + local AI stack

Adds the AI exploration tab. The agent services live in a separate repository
(`agent-poc`) and must be running and bound to `0.0.0.0`:

| Service | Port | Role |
|---|---|---|
| backend (FastAPI + LangGraph) | 8000 | `pali_agent`, DeepSeek + MCP corpus |
| runtime (CopilotKit) | 3001 | what the app talks to |
| MCP server | 3000 | wikipali corpus tools |
| Metro | 8081 | this repo |

```bash
# .env
EXPO_PUBLIC_RUNTIME_URL=http://<computer-ip>:3001/api/copilotkit
```

Checklist before testing on a device:

1. Phone and computer on the same WiFi.
2. Firewall allows inbound **3001** and **8081**.
3. `http://<computer-ip>:3001/api/copilotkit/info` opens in the phone's browser.

Smoke test: ask *"什么是四圣谛？"* — you should see a tool-call indicator first,
then a streamed answer citing SN 56.11.

### Mode C — Android emulator

Same development build APK, installed with `adb install`. Because the emulator
reaches the host through `10.0.2.2`, use `http://10.0.2.2:3001/api/copilotkit`
instead of the LAN IP.

### Mode D — iOS device or Simulator

iOS is supported and runs the same code; only the build differs
([iOS builds](#ios-builds)). Once the development build is installed:

```bash
npx expo start --lan     # or `npm run ios` to boot the Simulator directly
```

The **Simulator** shares the host's network, so `http://localhost:3001/...` and
`http://127.0.0.1:4000/...` work as-is — no LAN IP needed. A **physical iPhone**
needs the LAN IP, same as Android.

### Mode E — Waydroid (Android container on Linux)

Runs the same development build APK in an Android container on a Linux desktop —
no phone, no AVD. `10.0.2.2` does **not** work here; use the host's LAN IP.
Full command list: [6. Waydroid](#6-waydroid-android-on-a-linux-desktop).

### Web

`npm run web` exists but is **not a supported target** — the reader relies on
`react-native-webview` and the native chat modules.

## 5. Building the development client

### New to Expo? Start here

**Expo** is a toolchain on top of React Native. Two parts matter here:

- The **local CLI** (`npx expo start`) runs the Metro dev server that ships your
  JS/TS to the app. It needs no account.
- **EAS** (Expo Application Services) is Expo's cloud service that *compiles the
  native app* you install on the phone. This repo has no `android/` or `ios/`
  folder checked in; the native project is generated at build time.

You need that build once (an `.apk` on Android, an `.ipa`/`.app` on iOS),
because Expo Go cannot host this app's native modules.

### Do I need an Expo account?

**Yes — `eas build` requires a (free) Expo account**, for cloud builds and for
`--local` builds alike: *"EAS Build is available to anyone with an Expo account,
regardless of whether you pay for EAS or use the Free plan"*, and local builds
still ask you to *"Run `eas login`, or alternatively, set `EXPO_TOKEN`"*.

If you would rather not create one, see
[Building without an Expo account](#building-without-an-expo-account) below.

### One-time setup

1. **Create an account** at [expo.dev/signup](https://expo.dev/signup) (free plan
   is enough) and verify the email.

2. **Install the EAS CLI** and log in:

   ```bash
   npm install --global eas-cli
   eas login                 # email/username + password
   eas whoami                # confirms who you are logged in as
   ```

   No global install? Prefix every command with `npx eas-cli@latest` instead.

3. **Point the project at your own EAS project.** [`app.json`](../app.json) is
   committed with the upstream owner (`"owner": "iapt"`) and its
   `extra.eas.projectId`. Unless you were added to that Expo account, the build
   will be rejected. Fix it once:

   ```bash
   eas init      # creates a project under your account and rewrites projectId
   ```

   Then remove or change the `"owner"` field in `app.json`. Members of the
   upstream account skip this step entirely.

4. **Build.** [`eas.json`](../eas.json) is already committed, so there is no need
   to run `eas build:configure`:

   ```bash
   eas build -p android --profile development           # cloud build
   eas build -p android --profile development --local   # build on this machine
   ```

   The cloud build waits in a queue (free plan) and takes roughly 10–20 minutes.
   When it finishes, the CLI prints a build page URL with a QR code — open it on
   the phone, download the APK and install it (Android will ask you to allow
   installing from that browser).

   `--local` skips the queue but makes you responsible for the toolchain
   (Android SDK/NDK, JDK); it is supported on macOS and Linux only.

   For iOS, swap `-p android` for `-p ios` and read [iOS builds](#ios-builds)
   first — Apple adds an account requirement for physical devices.

### iOS builds

The same profile works for iOS, but Apple's rules add two constraints:

- **Physical iPhone/iPad** — requires a **paid Apple Developer Program account**:
  *"This method requires a paid Apple Developer account and that account will
  only be able to use this method to distribute to at most 100 iPhones per
  year."* Each device must be registered first (`eas device:create`), and adding
  a device later means rebuilding or re-signing.

  ```bash
  eas device:create                              # register the device UDID once
  eas build -p ios --profile development
  ```

- **iOS Simulator** — no Apple account needed, but the build profile has to say
  so. Add a simulator profile to [`eas.json`](../eas.json):

  ```json
  "development-simulator": {
    "developmentClient": true,
    "distribution": "internal",
    "ios": { "simulator": true }
  }
  ```

  ```bash
  eas build -p ios --profile development-simulator
  eas build:run -p ios --latest      # download and install onto the Simulator
  ```

Building iOS locally (`--local`, or `npx expo run:ios`) requires macOS with
Xcode.

### CI / non-interactive builds

Use a robot token instead of `eas login`:

```bash
export EXPO_TOKEN="<token>"
export CI=1
eas build -p android --profile development --non-interactive
```

### Building without an Expo account

`npx expo run:android` / `npx expo run:ios` compiles a debug development build
with your **locally installed** Android SDK or Xcode and installs it straight
onto a connected device, emulator or Simulator — no Expo account, no EAS:

```bash
npx expo run:android
npx expo run:ios        # macOS only
```

Prerequisite: a working [local environment](https://docs.expo.dev/get-started/set-up-your-environment/)
— Android Studio (SDK, platform tools, emulator or USB debugging) or Xcode. The
command generates the `android/` or `ios/` folder locally (both stay git-ignored)
and starts Metro for you.

### When do I need to rebuild the APK?

Business code is served by Metro at runtime, so the APK is essentially a
one-time install.

| Change | Rebuild? |
|---|---|
| JS/TS code, styles, components | No — Metro reloads |
| `EXPO_PUBLIC_*` in `.env` | No — restart `expo start` |
| `metro.config.js`, babel config | No — restart Metro |
| Add/upgrade/remove a dependency with native code | **Yes** |
| Native config in `app.json` (permissions, package id, icons, plugins) | **Yes** |
| Upgrade `expo-dev-client` or the Expo SDK major | **Yes** |

## 6. Waydroid (Android on a Linux desktop)

[Waydroid](https://waydro.id) boots Android in a container on your own machine
and runs the development build APK there. It requires a **Wayland** session — it
does not work under X11 — and a kernel with the `binder` modules (mainline 5.18+
ships them; otherwise install `linux-headers` + the `binder_linux` DKMS package
your distro provides).

### Install

Debian / Ubuntu (official repo):

```bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -s https://repo.waydro.id | sudo bash
sudo apt install -y waydroid
```

Arch / Manjaro:

```bash
yay -S waydroid          # plus binder_linux-dkms if your kernel lacks binder
```

Fedora:

```bash
sudo dnf install -y waydroid
```

Then download the Android image once (a few hundred MB):

```bash
sudo waydroid init                 # vanilla LineageOS image
sudo waydroid init -s GAPPS -f     # or with Google apps; -f re-downloads
```

### Start

```bash
sudo systemctl enable --now waydroid-container    # background service, survives reboots
waydroid session start &                          # your user's Android session
waydroid show-full-ui                             # open the Android home screen
```

Check it came up, and stop it when you are done:

```bash
waydroid status
waydroid session stop
sudo systemctl stop waydroid-container
```

### Multi-window mode

By default Waydroid paints one full-screen Android display. Multi-window gives
each Android app its own host window, which sits next to an editor much better:

```bash
waydroid prop set persist.waydroid.multi_windows true
waydroid session stop
waydroid session start &
```

To turn it off again, set the same prop to `false` and restart the session. In
multi-window mode launch the app directly rather than through `show-full-ui`:

```bash
waydroid app install ~/Downloads/wikipali-mobile-dev.apk
waydroid app list                       # find the package name if unsure
waydroid app launch com.iapt.mobile
```

### Put the window on a specific monitor

Waydroid has no monitor setting; placement belongs to your compositor. In
multi-window mode, match the window class `Waydroid` (`eDP-1` is usually the
laptop panel — confirm with `hyprctl monitors` / `swaymsg -t get_outputs`):

| Compositor | Rule |
|---|---|
| Hyprland | `windowrulev2 = monitor eDP-1, class:^(Waydroid)$` in `hyprland.conf` |
| Sway | `for_window [app_id="waydroid"] move container to output eDP-1` in the config |
| KWin (KDE) | Title bar → More Actions → Configure Special Window Settings → add **Screen**, Apply Initially |
| GNOME | No built-in rules; use the *Auto Move Windows* extension |

### Connect it to Metro

Waydroid is not an AVD, so `10.0.2.2` is meaningless here. Use either the host's
LAN IP or its address on the `waydroid0` bridge (usually `192.168.240.1`; check
with `ip -4 addr show waydroid0`):

```bash
npx expo start --lan
# in the development build's "Enter URL manually" box:
#   http://<computer-ip>:8081
```

The same address rule applies to `EXPO_PUBLIC_RUNTIME_URL` in `.env`.

## 7. Project layout

```
index.ts                 polyfill imports (order is mandatory) → App
App.tsx                  GestureHandler → SafeArea → CopilotKit → RootNavigator
metro.config.js          jose / node:* resolver fix
src/
  api/                   fetch wrapper, base-URL resolution, mock fallback
  catalog/               Tipiṭaka category tree, headings, labels
  components/            shared UI (chapter drawer, progress ring, screen)
  navigation/            5-tab bottom navigator + root stack
  screens/               category, bookshelf, explore/chat, tools, me, reader
  settings/              reader preferences, API server picker
  theme/                 colors, typography, reader theme
```

Architecture and product decisions live in [`docs/README.md`](./README.md).
