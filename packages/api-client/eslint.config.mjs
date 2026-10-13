import js from "@eslint/js";
import pluginQuery from "@tanstack/eslint-plugin-query";
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

// A query key comes from a domain factory in src/hooks/queryKeys.ts, so one prefix invalidates a
// family and a key typo cannot drop an invalidation. Same rule as apps/frontend's ban/query-key-literal.
const queryKeyLiteralBan = {
  selector:
    "Property[key.name='queryKey'] > ArrayExpression.value, CallExpression[callee.property.name=/^(getQueryData|setQueryData|getQueryState|fetchQuery|prefetchQuery|ensureQueryData)$/] > ArrayExpression.arguments:first-child",
  message: "Build the key with its domain's factory (src/hooks/queryKeys.ts); add the key there.",
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
    plugins: { "react-hooks": reactHooks, "@tanstack/query": pluginQuery },
    languageOptions: {
      // Type-aware, for the no-unsafe-* rules below.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // src/hooks is React Query hooks; same hook rules as apps/frontend.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Every value a queryFn reads is part of its key (a key factory call's arguments count). The API
      // client from useApiClient() is the same for every query, so it stays out of the keys.
      "@tanstack/query/exhaustive-deps": ["error", { allowlist: { variables: ["client"] } }],
      "@tanstack/query/no-unstable-deps": "error",
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
    // The polling module (src/polling.ts) is the one place the package sets timers, and it takes the
    // keys it invalidates from its callers. Tests may wait on real timers and poll made-up keys. An
    // override replaces the options of a rule for its files, so the other bans are restated here.
    files: ["src/**/*.ts"],
    ignores: ["src/polling.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", typedMockBan, pollIntervalBan, queryKeyLiteralBan, timerBan],
    },
  }
);
