import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Restrictions shared by the ban rules below. Rule options are per rule, and a later config object
// for the same files replaces them, so the lists are built from these constants.
const typedMockBan = {
  // vi.fn() is a Mock<(...args: any[]) => any>; give it the signature it stands in for.
  selector:
    "CallExpression[callee.object.name='vi'][callee.property.name='fn'][arguments.length=0]:not([typeArguments])",
  message: "Type the mock: vi.fn<(arg: T) => R>() or vi.fn(implementation).",
};

const openStateBan = {
  // Open state (a dialog, popover, menu, tooltip or lightbox) is a useDisclosure, one model throughout.
  selector:
    "VariableDeclarator[id.type='ArrayPattern'][id.elements.0.name=/(open|opened|modal|dialog)$/i][init.callee.name='useState']",
  message: "Open state is useDisclosure: const [isOpen, { open, close }] = useDisclosure(false).",
};

const routeModalBan = {
  selector: "JSXOpeningElement[name.name='Modal']",
  message:
    "Move the dialog into a *Modal component (components/album or components/modals) and open it with useDisclosure.",
};

export default [
  {
    ignores: ["node_modules/**", "**/dist/**", "**/build/**", "coverage/**", ".tanstack/**"],
  },
  {
    // Nothing is a warning: a disable comment that suppresses nothing fails the lint, like any
    // other finding. `--quiet` used to hide these.
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  {
    // Disable comments: line-scoped, of a rule that is enabled, with a `-- reason`.
    // Comments are not AST nodes, so no-restricted-syntax cannot check them.
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      "@eslint-community/eslint-comments/disable-enable-pair": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: ["eslint-enable"] }],
    },
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
      "react-hooks/exhaustive-deps": "error",

      // General rules
      "no-nested-ternary": "off",
      "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
      "no-redeclare": "off", // handled by TypeScript (Zod pattern: const X = z.object(); type X = z.infer<typeof X>)
      "no-undef": "off", // handled by TypeScript compiler
      // Debug logging stays out of the app; console.warn and console.error report real failures.
      "no-console": ["error", { allow: ["warn", "error"] }],
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
      "no-restricted-syntax": ["error", typedMockBan, openStateBan],
      // Dialogs are declarative components; the imperative @mantine/modals API is not used.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mantine/modals",
              message: "Dialogs are components opened with useDisclosure, not imperative modals.open*().",
            },
          ],
        },
      ],
      // Toasts have one colour and one entry point; see service/notifications/toast.ts.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mantine/notifications", "@mantine/notifications/*"],
              message:
                "Toasts go through service/notifications (notification.success, error, warning or hide), not @mantine/notifications.",
            },
          ],
        },
      ],
    },
  },
  {
    // The toast layer itself and the app shell (the Notifications provider and its styles) are the
    // only places that import @mantine/notifications. A later block replaces a rule's options for the
    // files it matches, so this turns the rule off for those files only.
    files: ["src/service/notifications/**/*.{ts,tsx}", "src/App.tsx"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // A route file holds no dialog: the Modal, its form and its state move to a *Modal component
    // (components/album next to the feature, or components/modals when shared). An override
    // replaces the options of a rule, so it lists the other restrictions again.
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", typedMockBan, openStateBan, routeModalBan],
    },
  },
  {
    // The Playwright suite has its own dependencies (e2e/yarn.lock); its types come from there.
    files: ["e2e/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./e2e/tsconfig.json",
      },
    },
  },
  {
    // Plain Node scripts and config files: no type-aware rules, Node globals.
    files: ["**/*.{mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // routeTree.gen.ts is generated by the TanStack router plugin, which writes the blanket
    // disable itself (vite.config.ts, routeTreeFileHeader).
    files: ["src/routeTree.gen.ts"],
    rules: {
      "@eslint-community/eslint-comments/no-unlimited-disable": "off",
      "@eslint-community/eslint-comments/disable-enable-pair": "off",
      "@eslint-community/eslint-comments/require-description": "off",
    },
  },
];
