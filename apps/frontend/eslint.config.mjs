import { fixupConfigRules } from "@eslint/compat";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import prettier from "eslint-plugin-prettier";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: ["**/eslint.config.mjs", "**/prettier.config.cjs", "**/proxy.js", "node_modules/*"],
  },
  ...fixupConfigRules(compat.extends("airbnb", "airbnb-typescript", "airbnb/hooks", "prettier")),
  {
    plugins: {
      prettier,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },

      ecmaVersion: 5,
      sourceType: "commonjs",

      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },

    rules: {
      "import/prefer-default-export": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      "import/no-cycle": "off",
      "react/jsx-props-no-spreading": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
