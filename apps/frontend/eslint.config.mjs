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
const modalsImportBan = {
  name: "@mantine/modals",
  message: "Dialogs are components opened with useDisclosure, not imperative modals.open*().",
};
// lodash itself is not a dependency (its CommonJS build drags in the whole library); lodash-es is.
const lodashImportBan = {
  name: "lodash",
  message: 'Import from "lodash-es" (lodash itself is not a dependency).',
};
const dayjsImportBan = {
  group: ["dayjs", "dayjs/*"],
  message: "dayjs is only for Mantine's date pickers. Use util/dateUtils (luxon) for dates.",
};
// Toasts have one colour and one entry point; see service/notifications/toast.ts.
const notificationsImportBan = {
  group: ["@mantine/notifications", "@mantine/notifications/*"],
  message:
    "Toasts go through service/notifications (notification.success, error, warning or hide), not @mantine/notifications.",
};
// Cookies have one home, so the auth cookies keep one set of flags (path, SameSite, Secure).
const cookiesImportBan = {
  name: "react-cookie",
  message: "Read and write cookies through src/api_client/authCookies.ts.",
};

// Lists and grids (AGENTS.md): photo layouts render through components/photolist/PhotoListView and
// fixed-size tiles through components/virtual/TileGrid, so every long list is virtualized one way.
const pigImportBan = {
  group: ["**/react-pig", "**/react-pig/*"],
  message:
    "Photo layouts render through components/photolist/PhotoListView (it re-exports the types); react-pig is its engine.",
};
const reactVirtualImportBan = {
  group: ["@tanstack/react-virtual", "@tanstack/react-virtual/*"],
  message: "Virtualize through components/virtual: TileGrid for tiles, PhotoListView for photos.",
};
// The faces grid is the one exception: its sections, scrubber and lazy pages need VirtualGrid itself.
const virtualGridImportBan = {
  group: ["**/virtual/VirtualGrid"],
  message: "Tile grids use components/virtual/TileGrid, which owns the cell index math and padding.",
};
const listImportBans = [pigImportBan, reactVirtualImportBan, virtualGridImportBan];
const tileIndexBan = {
  selector: "BinaryExpression[operator='*'][left.name='rowIndex']",
  message: "Render the tiles through components/virtual/TileGrid; it owns the cell index math.",
};

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

// Dates: util/dateUtils is the one module that parses and formats them (AGENTS.md).
const dateSyntaxBans = [
  {
    // Parsing a wall-clock exif_timestamp as an instant shifts it by the viewer's offset; the
    // parsers in util/dateUtils say which kind of timestamp a value is.
    selector:
      "MemberExpression[object.name='DateTime'][property.name=/^(fromISO|fromSQL|fromHTTP|fromRFC2822|fromSeconds|fromMillis|fromJSDate|fromFormat)$/]",
    message:
      "Parse dates through util/dateUtils (parseInstant, parsePhotoTimestamp, fromUnixSeconds, the picker helpers), not DateTime.from*.",
  },
  {
    // The UI locale is luxon's default, set once in i18n.ts; a per-call locale drifts from it.
    selector: "CallExpression[callee.property.name='setLocale']",
    message: "The UI locale is set once in i18n.ts (luxon's default locale). Format without .setLocale().",
  },
  {
    // new Date(value) parses a string by the engine's own rules; dateUtils owns parsing.
    // Multi-argument forms build a local Date from parts and are not parsing.
    selector: "NewExpression[callee.name='Date'][arguments.length=1]",
    message: "Parse dates through util/dateUtils, not new Date(value).",
  },
];
// A poll cadence is a named interval from the shared polling module (@librephotos/api-client). A number
// inside the property's
// value counts too, so `q => (busy ? 2000 : false)` is caught as well.
const pollIntervalBan = {
  selector: "Property[key.name=/^(refetchInterval|pollingInterval)$/] Literal[raw=/^[0-9]/]",
  message: "Poll with pollWhile(...) or a POLL_*_MS constant from @librephotos/api-client, not a number.",
};

// Timers in src/api_client belong to the shared polling module (pollUntil, invalidateAfter).
const apiClientTimerBan = {
  selector:
    "CallExpression[callee.name=/^(setTimeout|setInterval)$/], CallExpression[callee.object.name='window'][callee.property.name=/^(setTimeout|setInterval)$/]",
  message: "Use pollUntil or invalidateAfter from @librephotos/api-client instead of a raw timer.",
};

// Browser storage is read and written through util/storage, which owns the keys, the failure
// handling and the one-time move from an old key. Tests may set stored values up directly.
const storageMessage =
  "Use util/storage (readStored, writeStored or useStoredState) for browser storage; it owns the keys and the failure handling.";
const storageGlobalBans = [
  { name: "localStorage", message: storageMessage },
  { name: "sessionStorage", message: storageMessage },
];
const storagePropertyBans = ["window", "globalThis"].flatMap(object => [
  { object, property: "localStorage", message: storageMessage },
  { object, property: "sessionStorage", message: storageMessage },
]);

// Components talk through props or the lightbox commands (components/lightbox/lightboxCommands),
// not through custom events on window.
const eventMessage =
  "Pass props or use the lightbox commands (components/lightbox/lightboxCommands) instead of custom window events.";
const eventGlobalBans = [{ name: "CustomEvent", message: eventMessage }];
const windowEventBan = { object: "window", property: "dispatchEvent", message: eventMessage };

// The first load of a page or section is <PageLoader />, not a hand-rolled Center/Stack + Loader or a
// bare returned Loader (which sits in the top-left corner). An inline <Loader size="xs" /> next to a
// title during a refetch stays.
const notInlineLoader = ":not(:has(JSXAttribute[name.name='size'][value.value='xs']))";
const pageLoaderMessage = "First loads render <PageLoader /> (components/common/PageLoader).";
const pageLoaderBans = [
  {
    selector: `ReturnStatement > JSXElement[openingElement.name.name='Loader']${notInlineLoader}`,
    message: pageLoaderMessage,
  },
  {
    selector: `JSXElement[openingElement.name.name=/^(Center|Stack)$/] > JSXElement[openingElement.name.name='Loader']${notInlineLoader}`,
    message: pageLoaderMessage,
  },
];

// Render errors in a feature are caught by the one FeatureBoundary (components/common/FeatureBoundary).
const errorBoundaryBan = {
  selector: "MethodDefinition[key.name='componentDidCatch']",
  message: "Wrap the feature in <FeatureBoundary> (components/common/FeatureBoundary) instead of a new error boundary.",
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
      "no-restricted-syntax": [
        "error",
        typedMockBan,
        openStateBan,
        pollIntervalBan,
        tileIndexBan,
        ...dateSyntaxBans,
        ...pageLoaderBans,
        errorBoundaryBan,
      ],
      "no-restricted-globals": ["error", ...storageGlobalBans, ...eventGlobalBans],
      "no-restricted-properties": ["error", ...storagePropertyBans, windowEventBan],
      // Dialogs are declarative components; the imperative @mantine/modals API is not used.
      // One entry: a second "no-restricted-imports" key in this object would silently replace this one.
      // dayjs is only Mantine's date-picker glue (its locales are loaded in i18n.ts); dates are luxon.
      "no-restricted-imports": [
        "error",
        {
          paths: [modalsImportBan, cookiesImportBan, lodashImportBan],
          patterns: [notificationsImportBan, dayjsImportBan, ...listImportBans],
        },
      ],
    },
  },
  {
    // The auth cookie module and its test are the only places that import react-cookie. A later
    // block replaces a rule's options for the files it matches, so this keeps the other import bans.
    files: ["src/api_client/authCookies.ts", "src/api_client/authCookies.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [modalsImportBan, lodashImportBan],
          patterns: [notificationsImportBan, dayjsImportBan, ...listImportBans],
        },
      ],
    },
  },
  {
    // The toast layer itself and the app shell (the Notifications provider and its styles) are the
    // only places that import @mantine/notifications. A later block replaces a rule's options for the
    // files it matches, so this keeps the other import bans for those files.
    files: ["src/service/notifications/**/*.{ts,tsx}", "src/App.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [modalsImportBan, cookiesImportBan, lodashImportBan], patterns: [dayjsImportBan, ...listImportBans] },
      ],
    },
  },
  {
    // PhotoListView is the one module that renders react-pig (its test mocks it, and react-pig's own
    // tests import its parts); the other import bans still apply there.
    files: [
      "src/components/photolist/PhotoListView.tsx",
      "src/components/photolist/PhotoListView.test.tsx",
      "src/components/react-pig/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [modalsImportBan, cookiesImportBan, lodashImportBan],
          patterns: [notificationsImportBan, dayjsImportBan, reactVirtualImportBan, virtualGridImportBan],
        },
      ],
    },
  },
  {
    // The virtualization primitives themselves: TileGrid on VirtualGrid on @tanstack/react-virtual.
    // Restates the other bans of both rules for these files.
    files: ["src/components/virtual/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        typedMockBan,
        openStateBan,
        pollIntervalBan,
        ...dateSyntaxBans,
        ...pageLoaderBans,
        errorBoundaryBan,
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [modalsImportBan, cookiesImportBan, lodashImportBan],
          patterns: [notificationsImportBan, dayjsImportBan, pigImportBan],
        },
      ],
    },
  },
  {
    // The faces grid keeps VirtualGrid (person sections that collapse, the scrubber, pages loaded by
    // the rendered range): the documented exception to TileGrid.
    files: ["src/components/facedashboard/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [modalsImportBan, cookiesImportBan, lodashImportBan],
          patterns: [notificationsImportBan, dayjsImportBan, pigImportBan, reactVirtualImportBan],
        },
      ],
    },
  },
  {
    // A route file holds no dialog: the Modal, its form and its state move to a *Modal component
    // (components/album next to the feature, or components/modals when shared). An override
    // replaces the options of a rule, so it lists the other restrictions again.
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        typedMockBan,
        openStateBan,
        pollIntervalBan,
        tileIndexBan,
        routeModalBan,
        ...dateSyntaxBans,
        ...pageLoaderBans,
        errorBoundaryBan,
      ],
    },
  },
  {
    // The two components the loading and error bans point to, and the video player's buffering
    // overlay over its poster (not a page load). An override replaces the rule's options for these
    // files, so it lists the other restrictions again.
    files: ["src/components/common/PageLoader.tsx", "src/components/lightbox/VideoPlayer.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        typedMockBan,
        openStateBan,
        pollIntervalBan,
        tileIndexBan,
        ...dateSyntaxBans,
        errorBoundaryBan,
      ],
    },
  },
  {
    files: ["src/components/common/FeatureBoundary.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        typedMockBan,
        openStateBan,
        pollIntervalBan,
        tileIndexBan,
        ...dateSyntaxBans,
        ...pageLoaderBans,
      ],
    },
  },
  {
    // The shared polling module (packages/api-client) is the one place that sets timers, so no timer is
    // left here. Tests may wait on real timers. Restates the options of the rules it matches, like the route block.
    files: ["src/api_client/**/*.{ts,tsx}"],
    ignores: ["src/api_client/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        typedMockBan,
        openStateBan,
        pollIntervalBan,
        tileIndexBan,
        apiClientTimerBan,
        ...dateSyntaxBans,
        ...pageLoaderBans,
        errorBoundaryBan,
      ],
    },
  },
  {
    // The storage module is the one place browser storage is touched; the event bans still apply
    // to it. An override replaces the options of a rule for its files, so they are listed again.
    files: ["src/util/storage.ts"],
    rules: {
      "no-restricted-globals": ["error", ...eventGlobalBans],
      "no-restricted-properties": ["error", windowEventBan],
    },
  },
  {
    // Tests set stored values up and may dispatch a native event on window (a resize). A custom
    // event is still the in-app channel the rule is for, so CustomEvent stays banned in tests.
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", ...eventGlobalBans],
      "no-restricted-properties": "off",
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
