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
        ...globals.vitest,
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Fix the type error instead of silencing it.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true },
      ],

      // React rules
      "react/react-in-jsx-scope": "off",
      "react/jsx-boolean-value": "off",
      "react/jsx-props-no-spreading": "off",

      // React hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // General rules
      "no-nested-ternary": "off",
      "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
      "no-redeclare": "off", // handled by TypeScript (Zod pattern: const X = z.object(); type X = z.infer<typeof X>)
      "no-undef": "off", // handled by TypeScript compiler
    },
  },
  {
    // No `any`: neither written out nor flowing in from a library (JSON.parse, an untyped
    // mock, a catch-all prop type), and no assertion that claims more than the value is,
    // a non-null `!` included. Narrow unknown data with a type guard or parse it with its zod
    // schema; a test that needs a value to be there uses defined() (util/defined.test-utils).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/no-wrapper-object-types": "error",
      "no-restricted-syntax": [
        "error",
        {
          // vi.fn() is a Mock<(...args: any[]) => any>; give it the signature it stands in for.
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='fn'][arguments.length=0]:not([typeArguments])",
          message: "Type the mock: vi.fn<(arg: T) => R>() or vi.fn(implementation).",
        },
      ],
    },
  },
];
