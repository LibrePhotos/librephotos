import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixupConfigRules } from "@eslint/compat";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import prettier from "eslint-plugin-prettier";
import globals from "globals";

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

      // Use modern ECMAScript and ESM modules to match Vite/TypeScript setup
      ecmaVersion: "latest",
      sourceType: "module",

      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },

    settings: {
      // Help eslint-plugin-import resolve TS paths and avoid deep graph walks
      "import/resolver": {
        typescript: {
          project: "./tsconfig.eslint.json",
        },
        node: true,
      },
    },

    rules: {
      "no-nested-ternary": "off",
      "import/prefer-default-export": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      "import/no-cycle": "off",
      // Many files intentionally import from the same module in separate lines
      "import/no-duplicates": "off",
      // Temporarily disable rule that crashes under certain graph shapes
      "import/export": "off",
      // Allow omitting extensions for common module types
      "import/extensions": [
        "error",
        "ignorePackages",
        {
          js: "never",
          jsx: "never",
          ts: "never",
          tsx: "never",
        },
      ],
      // React 17+ with new JSX transform doesn't require React in scope
      "react/react-in-jsx-scope": "off",
      // TypeScript with optional props doesn't require defaultProps
      "react/require-default-props": "off",
      // Allow explicit boolean values in JSX when clearer for readability
      "react/jsx-boolean-value": "off",
      // Don't require deps for dev-only util hooks files
      "import/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: ["**/src/wdyr.ts", "**/*.test.{ts,tsx}", "**/e2e/**/*.{ts,tsx}"],
        },
      ],
      "react/jsx-props-no-spreading": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
