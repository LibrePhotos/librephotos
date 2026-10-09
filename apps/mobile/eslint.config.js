// ESLint flat config (Expo SDK 57). Extends eslint-config-expo's flat preset.
/* global __dirname -- this file is CommonJS, run by Node */
const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ["dist/*", "node_modules/*", ".expo/*", "expo-env.d.ts"],
  },
  {
    rules: {
      "import/order": "off",
      // eslint-config-expo 57 turns on the React Compiler rule set. A violation
      // does not break anything: the compiler just skips that component. The
      // sites that predate the rules (ref reads during render in the db
      // providers, setState-in-effect in the viewer, reanimated `.value`
      // writes in BottomSheet) are kept visible as warnings until they are
      // reworked one by one, rather than rewritten blind in an SDK bump.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    // No `any`: neither written out nor flowing in from a library (JSON.parse, a
    // test renderer's props), no ts-comment escapes, and no assertion that claims
    // more than the value is, a non-null `!` included. Narrow unknown data with a type
    // guard (src/lib/guards) or parse it with its zod schema; a test that needs a value
    // to be there uses defined() (src/test/defined).
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      // Type-aware, for the no-unsafe-* rules.
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    // `declare var` is the only declaration that adds a property to globalThis
    // (jest-globals.d.ts types the mocks jest.setup.js installs there).
    files: ["**/*.d.ts"],
    rules: { "no-var": "off" },
  },
]);
