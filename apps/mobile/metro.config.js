// Metro config: NativeWind + build-free consumption of the shared
// @librephotos/api-client and @librephotos/local-db packages (source-imported,
// no compile step).
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Let Metro watch (and bundle from source) the shared packages.
config.watchFolders = [
  path.resolve(workspaceRoot, "packages/api-client"),
  path.resolve(workspaceRoot, "packages/local-db"),
];

// Resolve app deps from the app's own node_modules first, then the (optional)
// hoisted root node_modules — so the shared package's peer deps (zod, react,
// @tanstack/react-query) resolve against the app's installed copies.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@librephotos/api-client": path.resolve(workspaceRoot, "packages/api-client"),
  "@librephotos/local-db": path.resolve(workspaceRoot, "packages/local-db"),
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
