// ESLint flat config (Expo SDK 57). Extends eslint-config-expo's flat preset.
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
]);
