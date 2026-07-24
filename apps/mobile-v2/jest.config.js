/**
 * Two jest projects:
 *   - "rn"   : jest-expo + RNTL for component/screen tests (jsdom-ish RN env).
 *   - "node" : plain Node env for the pure-TS DB + sync layer, which runs the
 *              real SQL against better-sqlite3 (native addon needs the node env,
 *              not the RN preset).
 *
 * The api-client is source-imported from packages/; both projects force
 * react/react-query/zod to THIS app's copies so there is exactly one of each
 * (Phase 0 handoff constraint).
 */
// Resolve the forced singletons by module resolution (not a hard-coded path):
// under npm workspaces these hoist to the repo-root node_modules, standalone
// they live in the app's — require.resolve finds either. Still one copy each,
// which is the Phase 0 invariant (source-imported api-client must share them).
const dir = (id) => require("path").dirname(require.resolve(`${id}/package.json`));
const RN_MODULE_NAME_MAPPER = {
  "^@librephotos/api-client$": "<rootDir>/../../packages/api-client/src/index.ts",
  "^react$": dir("react"),
  "^react/(.*)$": `${dir("react")}/$1`,
  "^react-dom$": dir("react-dom"),
  "^react-dom/(.*)$": `${dir("react-dom")}/$1`,
  "^@tanstack/react-query$": dir("@tanstack/react-query"),
  "^zod$": dir("zod"),
  "^@/(.*)$": "<rootDir>/src/$1",
};

/** Pure-TS Node tests never touch RN — only the api-client + app source aliases. */
const NODE_MODULE_NAME_MAPPER = {
  "^@librephotos/api-client$": "<rootDir>/../../packages/api-client/src/index.ts",
  "^zod$": "<rootDir>/node_modules/zod",
  "^@/(.*)$": "<rootDir>/src/$1",
};

module.exports = {
  projects: [
    {
      displayName: "rn",
      preset: "jest-expo",
      setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
      moduleNameMapper: RN_MODULE_NAME_MAPPER,
      modulePaths: ["<rootDir>/node_modules"],
      // DB + sync tests belong to the node project.
      testPathIgnorePatterns: [
        "<rootDir>/node_modules/",
        "<rootDir>/src/db/",
        "<rootDir>/src/sync/",
      ],
      transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|react-native-reanimated|react-native-worklets|@shopify/flash-list))",
      ],
    },
    {
      displayName: "node",
      testEnvironment: "node",
      testMatch: ["<rootDir>/src/db/**/*.test.ts", "<rootDir>/src/sync/**/*.test.ts"],
      moduleNameMapper: NODE_MODULE_NAME_MAPPER,
      transform: { "^.+\\.[jt]sx?$": "babel-jest" },
      transformIgnorePatterns: ["node_modules/(?!(drizzle-orm))"],
    },
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
};
