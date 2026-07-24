// ESLint flat config (Expo SDK 54). Extends eslint-config-expo's flat preset.
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
    },
  },
]);
