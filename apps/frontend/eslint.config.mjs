import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: ["**/eslint.config.mjs", "**/prettier.config.cjs", "**/proxy.js", "node_modules/*", "**/dist/*"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      prettier,
      "@typescript-eslint": tseslint,
      react,
      "react-hooks": reactHooks,
    },

    languageOptions: {
      parser: tsparser,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },

      ecmaVersion: "latest",
      sourceType: "module",

      parserOptions: {
        project: "./tsconfig.eslint.json",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    settings: {
      react: {
        version: "detect",
      },
    },

    rules: {
      // Prettier integration
      "prettier/prettier": "error",

      // TypeScript rules
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],

      // React rules
      "react/react-in-jsx-scope": "off",
      "react/jsx-boolean-value": "off",
      "react/jsx-props-no-spreading": "off",

      // React hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",

      // General rules
      "no-nested-ternary": "off",
      "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
      "no-redeclare": "off", // handled by TypeScript (Zod pattern: const X = z.object(); type X = z.infer<typeof X>)
      "no-undef": "off", // handled by TypeScript compiler
    },
  },
];
