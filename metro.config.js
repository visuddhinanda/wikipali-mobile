// Metro 配置：解决 jose 包的 node:* 导入问题（Hermes 无法打包 Node 内置模块）。
//
// 来源：CopilotKit React Native 官方文档 "Metro configuration for release bundles"
// jose 经 @copilotkit/shared -> @segment/analytics-node -> jose 传递依赖进入 bundle，
// 需要用 resolveRequest 让它走 browser 构建。
// 注意：不要全局设置 unstable_conditionNames（会波及所有双构建依赖）。
const { getDefaultConfig } = require("expo/metro-config");
const { mergeConfig } = require("@react-native/metro-config");

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // 离线目录库 assets/db/tipitaka.db3 要作为资源打包（默认 assetExts 只有 .db）
    assetExts: [...defaultConfig.resolver.assetExts, "db3"],
    resolveRequest: (context, moduleImport, platform) => {
      if (moduleImport === "jose" || moduleImport.startsWith("jose/")) {
        return context.resolveRequest(
          { ...context, unstable_conditionNames: ["browser"] },
          moduleImport,
          platform,
        );
      }
      return context.resolveRequest(context, moduleImport, platform);
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
