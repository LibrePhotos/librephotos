import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      // Type-aware, for the no-unsafe-* and promise rules below.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true },
      ],
      // Same no-`any` bar as the apps: rows are typed where a query declares them, never `any`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // Every query is async: a forgotten await is a write that may not have happened yet, or a
      // Promise tested for truthiness.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // An interactive transaction cannot be held safely over an executor shared by concurrent
      // callers (see README): atomic writes go through db.batch([...]).
      "no-restricted-syntax": [
        "error",
        {
          // better-sqlite3's own synchronous transactions (t.sqlite.transaction) are fine.
          selector:
            "CallExpression[callee.property.name='transaction']:not([callee.object.name='sqlite']):not([callee.object.property.name='sqlite'])",
          message: "Use db.batch([...]) for atomic writes; interactive transactions are not supported.",
        },
      ],
    },
  },
  {
    // The better-sqlite3 adapter is where a batch becomes a (synchronous) driver transaction;
    // database.test.ts checks that db.transaction() rejects.
    files: ["src/better-sqlite3.ts", "src/__tests__/database.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  }
);
