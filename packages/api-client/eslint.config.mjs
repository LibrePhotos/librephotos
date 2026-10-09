import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      // Type-aware, for the no-unsafe-* rules below.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Fix the type error instead of silencing it.
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true }],
      // No `any`: neither written out nor flowing in from a library (res.json(), JSON.parse,
      // an untyped mock), and no assertion that claims more than the value is, a non-null `!`
      // included (tests use defined() from __tests__/defined). Responses are `unknown` until
      // parseResponse() checks them against their schema.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
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
  }
);
