# patches/

本目录存放 `patch-package` 补丁。`package.json` 的 `postinstall` 脚本会运行
`patch-package`，在每次 `npm install` 之后把这些改动重新打到 `node_modules` 里，
因此改 `node_modules` 不会因为重装依赖而丢失。

---

## expo-location+57.0.16.patch

### 为什么需要这个补丁

`expo-location` 的 `getCurrentPositionAsync()` 在 Android 上走的是 Google Play
Services 的 `FusedLocationProviderClient.getCurrentLocation()`。在**没有 Google Play
Services（GMS）** 的设备上（典型如华为 / 荣耀，只带 HMS，没有
`com.google.android.gms`），这个调用会立刻抛错：

```
Location request has been rejected: 17: API: LocationServices.API is not available
on this device. Connection failed with: ConnectionResult{statusCode=SERVICE_INVALID}
```

表现是 App 一按定位就立刻失败（实测约 500ms 内返回 `error`，`elapsedMs` 几百毫秒），
拿不到任何坐标。这不是权限问题，也不是 expo-location 没装好 —— 是它对 GMS 的硬依赖。

实测设备：Honor `KOZ-AL00`（Android 10，紫光展锐 UMS512，无 `com.google.android.gms`，
只有 `com.huawei.hwid`）。

### 技术实现

在 `LocationHelpers.requestSingleLocation()` 入口先探测 GMS 是否可用：

```kotlin
GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
    == ConnectionResult.SUCCESS
```

- **GMS 可用**：保持原逻辑，走 `FusedLocationProviderClient.getCurrentLocation()`。
- **GMS 不可用**：回退到系统 `LocationManager.requestSingleUpdate()`，这条路完全不依赖 GMS。

回退逻辑按 provider 顺序逐个尝试，每个等待 40 秒（`FALLBACK_PROVIDER_TIMEOUT_MS`）
拿不到定位就换下一个：

```
GPS → network → fused → passive → 其它自定义 provider（如华为 local_database）
```

> **为什么是 40 秒**：GPS 冷启动（首次定位）实测 `TTFF`（Time To First Fix）约
> 25 秒，山区弱信号下可能更慢。40 秒给冷启动留足余量，又不会让拿不到卫星的用户
> 干等太久。之前设 10 秒时，GPS 在 fix 之前就被放弃、回退到基站网络定位，导致
> 无 WiFi 环境下偏差上百公里。

关键点：

- `requestSingleFromProvider()` 用**递归 + `settled` 标志**实现「先到先得」，保证同一个
  `Promise` 只会被 resolve/reject 一次。
- `Handler(Looper.getMainLooper()).postDelayed(...)` 负责每个 provider 的**级联超时**，
  超时后 `removeUpdates` 并跳到下一个 provider。
- `requestSingleUpdate` 在 API 30 之后被标记 deprecated，但功能仍在，用于单次定位足够。
- 为拿到 `Context`，`requestSingleLocation` 增加了 `context: Context` 参数，
  `LocationModule.getCurrentPositionAsync` 的两处调用点传入 `mContext`。
- 用 `Log.d/w("ExpoLocation", ...)` 打印回退过程，方便在 logcat 里排查走的是哪个 provider。

同一补丁还保留了 `records/LocationResults.kt` 里 `isoCountryCode` 的可空修复
（`String` → `String?`），避免某些地址缺国家码时反序列化崩溃。

### 生效方式

`package.json` 里配置了 `expo.autolinking.android.buildFromSource: ["expo-location"]`，
所以这个补丁改的是 Kotlin 源码，需要**重新 gradle 编译**才生效：

```bash
cd android && ./gradlew assembleDebug   # 或 assembleRelease
```

修改 JS 层（`src/`）不影响本补丁；本补丁只与原生构建有关。

---

## 其它补丁（简记）

- **@copilotkit+react-native+1.69.0.patch**：把流式请求的 `xhr.timeout` 从 60s 提到
  600s，避免长回复超时。
- **react-native-streamdown+0.2.0.patch**：`react-native-streamdown` 的 worklet 与
  Expo SDK 57 的 `react-native-worklets` 不兼容，改为在 JS 线程直接跑 `remend`
  （纯 JS 函数）。
