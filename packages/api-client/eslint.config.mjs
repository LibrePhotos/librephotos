import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// vi.fn() is a Mock<(...args: any[]) => any>; give it the signature it stands in for.
const typedMockBan = {
  selector:
    "CallExpression[callee.object.name='vi'][callee.property.name='fn'][arguments.length=0]:not([typeArguments])",
  message: "Type the mock: vi.fn<(arg: T) => R>() or vi.fn(implementation).",
};

// A poll cadence is a named interval from src/polling.ts (POLL_*_MS) or pollWhile(...). A number inside
// the property's value counts too, so `q => (busy ? 2000 : false)` is caught as well.
const pollIntervalBan = {
  selector: "Property[key.name=/^(refetchInterval|pollingInterval)$/] Literal[raw=/^[0-9]/]",
  message: "Poll with pollWhile(...) or a POLL_*_MS constant from src/polling.ts, not a number.",
};

const timerBan = {
  selector:
    "CallExpression[callee.name=/^(setTimeout|setInterval)$/], CallExpression[callee.object.name='window'][callee.property.name=/^(setTimeout|setInterval)$/]",
  message: "Use pollUntil or invalidateAfter from src/polling.ts instead of a raw timer.",
};

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      // Type-aware, for the no-unsafe-* rules below.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // src/hooks is React Query hooks; same hook rules as apps/frontend.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Fix the type error instead of silencing it.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true },
      ],
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
      // The web and mobile apps both run these schemas under zod 4: no zod 3 leftovers that zod 4
      // deprecates (.passthrough() -> z.looseObject, z.nativeEnum -> z.enum, .strict(), .merge()...).
      "@typescript-eslint/no-deprecated": "error",
      "no-restricted-syntax": ["error", typedMockBan, pollIntervalBan],
    },
  },
  {
    // The polling module (src/polling.ts) is the one place the package sets timers. Tests may wait on
    // real timers. An override replaces the options of a rule for its files, so the other bans are
    // restated here.
    files: ["src/**/*.ts"],
    ignores: ["src/polling.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", typedMockBan, pollIntervalBan, timerBan],
    },
  }
);
