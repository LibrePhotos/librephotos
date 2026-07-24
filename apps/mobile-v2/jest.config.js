/** jest-expo + React Native Testing Library. */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    // Build-free consumption of the shared package (source import).
    "^@librephotos/api-client$": "<rootDir>/../../packages/api-client/src/index.ts",
    // The shared package carries its own react/react-query/zod (vitest devDeps).
    // Force the singletons to THIS app's copies so there is exactly one React —
    // otherwise the source-imported provider renders elements from react@18 and
    // react-test-renderer (react@19) rejects them.
    "^react$": "<rootDir>/node_modules/react",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react-dom/(.*)$": "<rootDir>/node_modules/react-dom/$1",
    "^@tanstack/react-query$": "<rootDir>/node_modules/@tanstack/react-query",
    "^zod$": "<rootDir>/node_modules/zod",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // The shared api-client is source-imported from outside this app's tree, so its
  // bare imports (@babel/runtime, zod, react, @tanstack/react-query) must resolve
  // against THIS app's node_modules.
  modulePaths: ["<rootDir>/node_modules"],
  // Transform the RN/Expo/NativeWind ESM packages plus the shared api-client
  // source that lives outside node_modules.
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|react-native-reanimated|react-native-worklets|@shopify/flash-list))",
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
};
