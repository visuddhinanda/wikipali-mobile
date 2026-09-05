<div align="center">

# Wikipali Mobile · 法音

**一款阅读巴利三藏的手机 App（Android / iOS）** —— 按传统分类浏览三藏、对照阅读各语种
译本，向 AI 提问并得到带经文引用的回答

基于 [WikiPali](https://www.wikipali.org) 语料 · Expo SDK 57 · React Native 0.86 · TypeScript

[English](README.md) · **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-57-blue.svg)](https://docs.expo.dev/versions/v57.0.0/)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61dafb.svg)](https://reactnative.dev)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20iOS-3ddc84.svg)](docs/development.md#4-run-modes)

</div>

---

法音（Wikipali Mobile）是 [wikipali.org](https://www.wikipali.org) 的**手机客户端**：
把巴利三藏、多语种译本与 AI 学习助手装进手机。用 Expo + React Native 开发，一套代码
同时构建 Android 与 iOS App。本仓库是这个 App 本身；语料与它读取的 API 在
[mint](https://github.com/iapt-platform/mint) 后端。

## 快速开始

```bash
git clone <repo-url> wikipali-mobile
cd wikipali-mobile
npm install               # postinstall 会应用 patches/ 下的补丁，勿跳过
cp .env.example .env
npx expo start --lan
```

打开手机上的 development build，连接 `http://<电脑IP>:8081`。
`.env` 留空时 App 直接读线上的 `next.wikipali.org`，不需要任何额外配置。

> [!IMPORTANT]
> **不能用 Expo Go。** 项目依赖 Expo Go 预编译运行时不包含的原生模块，必须先装一次
> **development build** APK —— 见下方[首次运行](#首次运行安装-development-build)
> （[原因](docs/troubleshooting.md#expo-go-crashes)）。

> [!NOTE]
> [`patches/`](patches) 下的补丁是必需的 ——
> [它们修了什么](docs/troubleshooting.md#patched-dependencies)。

## 功能

| 模块 | 说明 |
|---|---|
| **三藏浏览** | 经藏 / 律藏 / 论藏分类树直到章节，目录随包离线，无网也能展开 |
| **版本与译本** | 按类型分组的章节频道列表，带进度环与最近更新时间 |
| **阅读器** | HTML 阅读视图，支持章节抽屉与阅读设置 |
| **探索（AI）** | 基于 CopilotKit agent 的流式问答，显示工具调用状态，经文引用可点击跳转阅读器 |
| **书架** | 本地阅读记录，同书合并，显示进度 |
| **设置** | 运行时切换 WikiPali API 服务器 |

## 首次运行：安装 development build

每台设备只需装一次；之后所有 JS/TS 改动都由 Metro 现拉热更。

1. **环境要求** —— Node.js ≥ 20.19、npm 10+、Android 真机/模拟器或 iOS 真机/模拟器，
   以及一个免费的 [Expo 账号](https://expo.dev/signup)
   （[Expo 是什么、为什么需要账号](docs/development.md#do-i-need-an-expo-account)）。

2. **一次性 Expo 准备** —— 注册后 `eas login`，再用 `eas init` 把项目指向你自己的
   EAS project。完整步骤见
   [One-time setup](docs/development.md#one-time-setup)。

3. **构建并安装：**

   ```bash
   eas build -p android --profile development
   eas build -p ios --profile development       # iOS 另见下方说明
   ```

   CLI 会打印构建页地址（含二维码），用手机打开下载安装即可。

   iOS **真机**还需要付费的 Apple Developer 账号，并用 `eas device:create` 登记设备；
   **模拟器**不需要 Apple 账号，但要额外配一个 simulator 构建 profile ——
   见 [iOS builds](docs/development.md#ios-builds)。

> [!TIP]
> 只有**原生**依赖或原生配置变动时才需要重新构建 ——
> [判断标准](docs/development.md#when-do-i-need-to-rebuild-the-apk)。
> 不想注册 Expo 账号？可以用本地 Android Studio / Xcode 构建：
> [`npx expo run:android` / `run:ios`](docs/development.md#building-without-an-expo-account)。

## 运行环境

| 环境 | 能用到什么 | 准备工作 |
|---|---|---|
| **真机 + 线上 API** | 完整阅读链路（走 `next.wikipali.org`），AI 页不可用 | 无需配置，`.env` 留空即可 |
| **真机 + 本地 AI 服务** | 增加流式 AI 问答 | 启动 `agent-poc` 各服务，并把 `EXPO_PUBLIC_RUNTIME_URL` 指向电脑局域网 IP |
| **Android 模拟器** | 同一个 APK，`adb install` 安装 | 用 `10.0.2.2` 代替局域网 IP |
| **Waydroid** | 在 Linux 桌面的 Android 容器里运行同一个 App | `waydroid app install` 装 APK，连宿主机局域网 IP（不是 `10.0.2.2`）——[安装与多窗口模式](docs/development.md#6-waydroid-android-on-a-linux-desktop) |
| **iOS 真机 / 模拟器** | 同一套代码跑在 iOS 上 | 模拟器与电脑共用网络，直接用 `localhost` 即可 |

Web 不作为支持目标。各环境的详细步骤见
[开发指南 → Run modes](docs/development.md#4-run-modes)（英文）。

<details>
<summary><b>配置（两个变量都是可选的）</b></summary>

| 变量 | 用途 |
|---|---|
| `EXPO_PUBLIC_RUNTIME_URL` | AI 页使用的 CopilotKit runtime 地址 |
| `EXPO_PUBLIC_API_URL` | 覆盖内容 API 的基础地址 |

`.env` 留空时，后端地址取自 **我 → 设置 → API 服务器**（默认 `next.wikipali.org`）。

真机上的 `localhost` 指向手机自己，必须填电脑的局域网 IP；`EXPO_PUBLIC_*` 在打包时
内联，改完 `.env` 需重启 `expo start`。
</details>

## 仓库结构

```
index.ts           polyfill 导入（顺序强制）→ App
App.tsx            GestureHandler → SafeArea → CopilotKit → RootNavigator
metro.config.js    jose / node:* 解析修复
src/               api · catalog · components · navigation · screens · settings · theme
patches/           必需的 patch-package 补丁
docs/              开发指南与问题排查
```

## 文档

| 文档 | 内容 |
|---|---|
| [开发指南](docs/development.md) | 环境要求、配置、运行环境、EAS 构建、Waydroid、目录结构（英文） |
| [问题排查](docs/troubleshooting.md) | Expo Go、Metro/jose、polyfill 顺序、补丁、文件监听上限、网络（英文） |
| [DESIGN.md](DESIGN.md) | 产品与架构设计文档 |
| [DESIGN.chat.md](DESIGN.chat.md) | AI 探索 / 问答页设计 |
| [STATUS.md](STATUS.md) | 进度记录 |

## 相关链接

- [WikiPali 网站](https://www.wikipali.org) —— App 读取的语料来源
- [iapt-platform/mint](https://github.com/iapt-platform/mint) —— 后端 Laravel API
- [Expo SDK 57 文档](https://docs.expo.dev/versions/v57.0.0/)

## License

[MIT](LICENSE) © visuddhinanda
