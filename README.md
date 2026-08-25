# mobile/ —— Expo App（Android 真机，development build）

Expo SDK 57（React Native 0.86，TypeScript 模板）+ `@copilotkit/react-native` 1.69：

- 入口 `index.ts`：最前面导入 polyfill（顺序是强制的，勿调整）：
  `react-native-get-random-values`（第 1 行）→ `@copilotkit/react-native/polyfills`
- `App.tsx`：`<CopilotKitProvider runtimeUrl={...}>` 包住预制 `<CopilotChat agentName="pali_agent" />`
- `metro.config.js`：官方文档的 jose 修复（否则 Metro 打 bundle 报 `Unable to resolve module node:buffer`）

> ⚠️ **不能用 Expo Go**。项目依赖 `react-native-enriched-markdown`（含 android/ios/cpp **原生代码**）等原生模块，
> Expo Go 预编译运行时**不含**这些模块，AI 一输出 markdown 回答就会报
> `EnrichedMarkdownText ... not found in ViewManagerRegistry` 并闪退。
> 必须使用 **development build**（已装 `expo-dev-client`），见下方「启动」。

## 端口

- Expo/Metro **8081**（`npx expo start`）
- 依赖 runtime **3001**（再往前 backend **8000**），两个服务均已绑定 `0.0.0.0`

## 真机测试前必做

1. **手机和电脑连同一个 WiFi**
2. **电脑防火墙放行 3001（runtime）和 8081（Metro）端口**，否则手机连不上
3. 把 runtime 地址改成电脑的局域网 IP：

```bash
cd mobile
cp .env.example .env
# 编辑 .env：EXPO_PUBLIC_RUNTIME_URL=http://<电脑IP>:3001/api/copilotkit
# 查看电脑 IP：Windows `ipconfig`；macOS/Linux `ifconfig` 或 `ip addr`
```

> 手机上不能用 localhost/127.0.0.1（那指向手机自己）。

## 启动（先启动 backend 和 runtime）

### 1. 构建并安装 development build

```bash
cd mobile
npm install
# 云端构建（需 EAS 账号/robot token）：
eas build -p android --profile development
# 或本地构建：eas build -p android --profile development --local
# 把生成的 APK 装到手机上
```

> development build 的 APK **基本只装一次**：纯 JS/TS 改动无需重新构建，Metro 现拉热更；
> 只有「新增/升级含原生代码的依赖」或「改 `app.json` 原生配置」时才需要重新 `eas build`。
> 详细的 EAS/沙箱注意事项见 `STATUS.md`。

### 2. 启动 Metro 并连接

```bash
cd mobile
npx expo start          # 或 npm start
# 手机打开已安装的 development build，输入开发服务器地址：exp://<电脑IP>:8081
# 改过 .env 后需要重启 expo start
```

## 验证

1. 打开 development build 应用并连接 Metro（首次 bundle 可能要等 1-2 分钟）
2. 输入「什么是四圣谛？」发送
3. 预期：先看到工具调用状态（`retrieve_sutta_passage`），随后流式回答
   （引用 SN 56.11 经文；未配置 DEEPSEEK_API_KEY 时带「mock 演示模式」前缀）
4. 若一直转圈：确认手机浏览器能打开 `http://<电脑IP>:3001/api/copilotkit/info`（通则网络/防火墙 OK）

## 已知坑（已处理）

- **不能用 Expo Go**：原生依赖（`react-native-enriched-markdown` 等）不在 Expo Go 运行时内，必须 development build
- **jose 的 node:* 导入**：Metro 打包报错，`metro.config.js` 里用官方 resolveRequest 修复
- **polyfill 顺序**：安全随机源必须第一行，否则 CopilotKit 锁死非加密随机回退
- **导入面**：`/components`（CopilotChat）与根入口都要装全 peer 依赖
  （@gorhom/bottom-sheet、expo-document-picker、expo-file-system 等，已用 expo install 装好）
