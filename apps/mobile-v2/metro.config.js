// Metro config: NativeWind + build-free consumption of the shared
// @librephotos/api-client package (source-imported, no compile step).
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Let Metro watch (and bundle from source) the shared package.
config.watchFolders = [path.resolve(workspaceRoot, "packages/api-client")];

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
};

// Drizzle's expo-sqlite migrator imports the generated `.sql` migrations as
// raw source modules; teach Metro to treat `.sql` as a source extension.
config.resolver.sourceExts.push("sql");

module.exports = withNativeWind(config, { input: "./src/global.css" });
