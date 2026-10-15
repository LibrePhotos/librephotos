import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import pluginQuery from "@tanstack/eslint-plugin-query";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-plugin-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import { builtinRules } from "eslint/use-at-your-own-risk";
import globals from "globals";

const TS_FILES = ["**/*.{ts,tsx}"];
// Test code: test files, their shared fixtures and the issue repros.
const TEST_FILES = ["**/*.test.{ts,tsx}", "**/*.test-utils.{ts,tsx}", "src/__repro__/**"];
// The app itself; the Playwright suite (e2e/) drives it from outside.
const APP_FILES = ["src/**/*.{ts,tsx}"];

// ---------------------------------------------------------------------------------------------------
// Convention bans. Add a ban as one entry in the list for its rule, never as a rule in a config block:
//
//   { id: "kebab-name", message: "Use X (path/to/module) instead.", files?: [globs], allowIn?: [globs], ...item }
//
// `item` is that rule's own option (importBans: `name` or `group`; syntaxBans: `selector`; globalBans:
// `name`; propertyBans: `object` and `property`). `files` narrows where the ban applies (default: every
// TS file), `allowIn` lists the files that are exempt (the module that owns the thing, its tests).
// Each entry becomes its own rule, `ban/<id>`, in its own config block, so an exemption for one ban can
// never drop another, a disable comment names the ban it silences, and eslint.config.test.mjs checks
// every entry. Nothing else in this file may set no-restricted-imports, -syntax, -globals or -properties.
// ---------------------------------------------------------------------------------------------------

// @typescript-eslint/no-restricted-imports: `name` (with optional `importNames`), `group` or `regex`,
// and `allowTypeImports`.
export const importBans = [
  {
    id: "mantine-modals",
    name: "@mantine/modals",
    message: "Dialogs are components opened with useDisclosure, not imperative modals.open*().",
  },
  {
    // lodash itself is not a dependency (its CommonJS build drags in the whole library); lodash-es is.
    id: "lodash",
    name: "lodash",
    message: 'Import from "lodash-es" (lodash itself is not a dependency).',
  },
  {
    // dayjs is only Mantine's date-picker glue (its locales are loaded in i18n.ts); dates are luxon.
    id: "dayjs",
    group: ["dayjs", "dayjs/*"],
    message: "dayjs is only for Mantine's date pickers. Use util/dateUtils (luxon) for dates.",
  },
  {
    // Toasts have one colour and one entry point; see service/notifications/toast.ts. The app shell
    // mounts the Notifications provider and its styles.
    id: "mantine-notifications",
    group: ["@mantine/notifications", "@mantine/notifications/*"],
    message:
      "Toasts go through service/notifications (notification.success, error, warning or hide), not @mantine/notifications.",
    allowIn: ["src/service/notifications/**/*.{ts,tsx}", "src/App.tsx"],
  },
  {
    // Cookies have one home, so the auth cookies keep one set of flags (path, SameSite, Secure).
    id: "react-cookie",
    name: "react-cookie",
    message: "Read and write cookies through src/api_client/authCookies.ts.",
    allowIn: ["src/api_client/authCookies.ts", "src/api_client/authCookies.test.ts"],
  },
  // Lists and grids (AGENTS.md): photo layouts render through components/photolist/PhotoListView and
  // fixed-size tiles through components/virtual/TileGrid, so every long list is virtualized one way.
  {
    // PhotoListView is the one module that renders react-pig (its test mocks it, and react-pig's own
    // tests import its parts).
    id: "react-pig",
    group: ["**/react-pig", "**/react-pig/*"],
    message:
      "Photo layouts render through components/photolist/PhotoListView (it re-exports the types); react-pig is its engine.",
    allowIn: [
      "src/components/photolist/PhotoListView.tsx",
      "src/components/photolist/PhotoListView.test.tsx",
      "src/components/react-pig/**/*.{ts,tsx}",
    ],
  },
  {
    // The virtualization primitives themselves: TileGrid on VirtualGrid on @tanstack/react-virtual.
    id: "react-virtual",
    group: ["@tanstack/react-virtual", "@tanstack/react-virtual/*"],
    message:
      "Virtualize through components/virtual: TileGrid for tiles, VirtualList for rows, PhotoListView for photos.",
    allowIn: ["src/components/virtual/**/*.{ts,tsx}"],
  },
  {
    // The faces grid keeps VirtualGrid (person sections that collapse, the scrubber, pages loaded by
    // the rendered range): the documented exception to TileGrid.
    id: "virtual-grid",
    group: ["**/virtual/VirtualGrid"],
    message: "Tile grids use components/virtual/TileGrid, which owns the cell index math and padding.",
    allowIn: ["src/components/virtual/**/*.{ts,tsx}", "src/components/facedashboard/**/*.{ts,tsx}"],
  },
  {
    // Hooks and components get the client from useQueryClient(), so a test renders them with a fresh
    // client instead of mocking the API module. The singleton is created in api_client/api.ts and
    // provided in index.tsx. Old importers sit in eslint-suppressions.json.
    id: "query-client-singleton",
    regex: String.raw`^(\.\.?/)+(api_client/)?api$`,
    importNames: ["queryClient"],
    message: "Get the client from useQueryClient() (@tanstack/react-query), not the queryClient singleton.",
    allowIn: ["src/api_client/api.ts", "src/index.tsx", "**/*.test.{ts,tsx}", "**/*.test-utils.{ts,tsx}"],
  },
  {
    // Requests start in src/api_client (AGENTS.md): a component, route, hooks/ or util/ module calls a
    // hook or function from there, never the client. index.tsx hands the client to ApiClientProvider.
    id: "api-client-import",
    regex: String.raw`^(\.\.?/)+(api_client/)?api$`,
    importNames: ["apiClient"],
    message:
      "Call a hook or function from src/api_client/<domain> (add one there), not apiClient: requests start in the API layer.",
    allowIn: ["src/api_client/**/*.{ts,tsx}", "src/index.tsx"],
  },
  // The API layer (AGENTS.md, issue #2347): packages/api-client owns every request, its zod schema
  // and its parse; src/api_client keeps thin hooks around endpoints.*. Old offenders sit in
  // eslint-suppressions.json and leave it domain by domain.
  {
    id: "api-client-zod",
    files: ["src/api_client/**/*.{ts,tsx}"],
    group: ["zod", "zod/*"],
    message:
      "Response schemas live in packages/api-client/src/schemas; src/api_client/<domain>/types.ts only re-exports them.",
  },
  {
    id: "api-client-zod-utils",
    files: ["src/api_client/**/*.{ts,tsx}"],
    group: ["**/util/zodUtils"],
    message:
      "Parse in the package endpoint (parseResponse); the web hook calls endpoints.* from @librephotos/api-client.",
  },
  {
    // jsdom's getComputedStyle matches every rule of every loaded stylesheet against the element, and
    // focus() and Popover/Menu positioning call it all the time: with Mantine's ~1,200 rules a dialog
    // test spent most of its time there and hit the 5 s timeout on a busy machine.
    id: "test-mantine-stylesheet",
    files: ["src/**/*.test.{ts,tsx}"],
    name: "@mantine/core/styles.css",
    message:
      "Tests do not need Mantine's whole stylesheet. Import only the sheets the assertions read, e.g. @mantine/core/styles/Button.css.",
  },
];

// no-restricted-syntax: `selector` (an AST selector).
export const syntaxBans = [
  {
    // vi.fn() is a Mock<(...args: any[]) => any>; give it the signature it stands in for.
    id: "untyped-mock",
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name='fn'][arguments.length=0]:not([typeArguments])",
    message: "Type the mock: vi.fn<(arg: T) => R>() or vi.fn(implementation).",
  },
  {
    // Open state (a dialog, popover, menu, tooltip or lightbox) is a useDisclosure, one model throughout.
    id: "open-state",
    selector:
      "VariableDeclarator[id.type='ArrayPattern'][id.elements.0.name=/(open|opened|modal|dialog)$/i][init.callee.name='useState']",
    message: "Open state is useDisclosure: const [isOpen, { open, close }] = useDisclosure(false).",
  },
  {
    // A route file holds no dialog: the Modal, its form and its state move to a *Modal component
    // (components/album next to the feature, or components/modals when shared).
    id: "route-modal",
    files: ["src/routes/**/*.{ts,tsx}"],
    selector: "JSXOpeningElement[name.name='Modal']",
    message:
      "Move the dialog into a *Modal component (components/album or components/modals) and open it with useDisclosure.",
  },
  {
    // Mantine mounts a panel when `ctx.keepMounted || keepMounted`, and <Tabs> defaults keepMounted to
    // true, so keepMounted={false} on a panel is a no-op.
    id: "tabs-panel-keep-mounted",
    selector:
      "JSXOpeningElement[name.object.name='Tabs'][name.property.name='Panel'] > JSXAttribute[name.name='keepMounted'][value.expression.value=false]",
    message:
      "keepMounted={false} on Tabs.Panel does nothing: <Tabs> keeps panels mounted by default and wins. Hidden panels render under React <Activity mode='hidden'> (no effects, no fetches, state kept); to unmount them set keepMounted={false} on <Tabs>.",
  },
  // Dates: util/dateUtils is the one module that parses and formats them (AGENTS.md).
  {
    // Parsing a wall-clock exif_timestamp as an instant shifts it by the viewer's offset; the
    // parsers in util/dateUtils say which kind of timestamp a value is.
    id: "date-parse",
    selector:
      "MemberExpression[object.name='DateTime'][property.name=/^(fromISO|fromSQL|fromHTTP|fromRFC2822|fromSeconds|fromMillis|fromJSDate|fromFormat)$/]",
    message:
      "Parse dates through util/dateUtils (parseInstant, parsePhotoTimestamp, fromUnixSeconds, the picker helpers), not DateTime.from*.",
    allowIn: ["src/util/dateUtils.ts"],
  },
  {
    // The UI locale is luxon's default, set once in i18n.ts; a per-call locale drifts from it.
    id: "date-set-locale",
    selector: "CallExpression[callee.property.name='setLocale']",
    message: "The UI locale is set once in i18n.ts (luxon's default locale). Format without .setLocale().",
    allowIn: ["src/util/dateUtils.ts"],
  },
  {
    // new Date(value) parses a string by the engine's own rules; dateUtils owns parsing.
    // Multi-argument forms build a local Date from parts and are not parsing.
    id: "date-constructor",
    selector: "NewExpression[callee.name='Date'][arguments.length=1]",
    message: "Parse dates through util/dateUtils, not new Date(value).",
    allowIn: ["src/util/dateUtils.ts"],
  },
  {
    // A poll cadence is a named interval from the shared polling module (@librephotos/api-client). A number inside the property's
    // value counts too, so `q => (busy ? 2000 : false)` is caught as well.
    id: "poll-interval",
    selector: "Property[key.name=/^(refetchInterval|pollingInterval)$/] Literal[raw=/^[0-9]/]",
    message: "Poll with pollWhile(...) or a POLL_*_MS constant from @librephotos/api-client, not a number.",
  },
  {
    // A query key comes from its domain's factory in @librephotos/api-client
    // (packages/api-client/src/hooks/queryKeys.ts, photoGridKeys for every photo grid), shared with the
    // mobile app, so one prefix invalidates a family and a key typo cannot drop an invalidation. No
    // array literal as a queryKey, or as the key of a cache read or write.
    id: "query-key-literal",
    selector:
      "Property[key.name='queryKey'] > ArrayExpression.value, CallExpression[callee.property.name=/^(getQueryData|setQueryData|getQueryState|fetchQuery|prefetchQuery|ensureQueryData)$/] > ArrayExpression.arguments:first-child",
    message:
      "Build the key with its domain's factory from @librephotos/api-client (packages/api-client/src/hooks/queryKeys.ts, photoGridKeys for photo grids); add the key there.",
  },
  {
    // A schema, type, key factory or endpoint of the shared package has one import path: the package.
    // A re-export gives it a second path (often a second name), which is how the web's api_client
    // types.ts and keys.ts files drifted from the package (#2347).
    id: "api-client-reexport",
    files: APP_FILES,
    selector:
      "ExportNamedDeclaration[source.value='@librephotos/api-client'], ExportAllDeclaration[source.value='@librephotos/api-client']",
    message: "Import it from @librephotos/api-client where it is used; do not re-export the shared package.",
  },
  {
    // Files under /media/ (thumbnails, originals, videos, faces, archives) get their URL from
    // mediaUrl / shareMediaUrl in src/api_client/media/mediaUrl.ts, the shared builders with the
    // server address bound, so a path or prefix changes in one place. Tests assert on the strings.
    id: "media-url",
    files: APP_FILES,
    // A module path (api_client/media/...) is not a URL.
    selector: String.raw`TemplateElement[value.raw=/\/media\//], Literal[value=/\/media\//]:not(:matches(ImportDeclaration, ExportAllDeclaration, ExportNamedDeclaration, ImportExpression) > Literal)`,
    message: "Build media URLs with mediaUrl.* (src/api_client/media/mediaUrl.ts), not a hand-written /media/ path.",
    allowIn: ["src/api_client/media/**/*.{ts,tsx}", ...TEST_FILES],
  },
  {
    id: "tile-index",
    selector: "BinaryExpression[operator='*'][left.name='rowIndex']",
    message: "Render the tiles through components/virtual/TileGrid; it owns the cell index math.",
    allowIn: ["src/components/virtual/**/*.{ts,tsx}"],
  },
  {
    // Timers in src/api_client belong to the shared polling module in @librephotos/api-client
    // (pollUntil, invalidateAfter), so none is left here. Tests may wait on real timers.
    id: "api-client-timer",
    files: ["src/api_client/**/*.{ts,tsx}"],
    selector:
      "CallExpression[callee.name=/^(setTimeout|setInterval)$/], CallExpression[callee.object.name='window'][callee.property.name=/^(setTimeout|setInterval)$/]",
    message: "Use pollUntil or invalidateAfter from @librephotos/api-client instead of a raw timer.",
    allowIn: ["src/api_client/**/*.test.{ts,tsx}"],
  },
  // The first load of a page or section is <PageLoader />, not a hand-rolled Center/Stack + Loader or
  // a bare returned Loader (which sits in the top-left corner). An inline <Loader size="xs" /> next to
  // a title during a refetch stays. Exempt: PageLoader itself and the video player's buffering
  // overlay over its poster (not a page load).
  ...[
    { id: "page-loader-returned", parent: "ReturnStatement" },
    { id: "page-loader-wrapped", parent: "JSXElement[openingElement.name.name=/^(Center|Stack)$/]" },
  ].map(({ id, parent }) => ({
    id,
    selector: `${parent} > JSXElement[openingElement.name.name='Loader']:not(:has(JSXAttribute[name.name='size'][value.value='xs']))`,
    message: "First loads render <PageLoader /> (components/common/PageLoader).",
    allowIn: ["src/components/common/PageLoader.tsx", "src/components/lightbox/VideoPlayer.tsx"],
  })),
  // Translations (AGENTS.md): the English text lives only in src/locales/en/translation.json, which
  // Weblate translates; a copy in the code drifts from it and never reaches translators. Keys are
  // type-checked against that file (src/@types/i18next.d.ts).
  {
    id: "t-default",
    selector:
      "CallExpression:matches([callee.name='t'], [callee.property.name='t']) > :not(ObjectExpression):nth-child(2)",
    message: "No English default in t(): add the string to src/locales/en/translation.json and call t(key).",
  },
  {
    id: "t-default-value",
    selector:
      "CallExpression:matches([callee.name='t'], [callee.property.name='t']) > ObjectExpression > Property[key.name='defaultValue']",
    message: "No defaultValue in t(): add the string to src/locales/en/translation.json and call t(key).",
  },
  {
    id: "trans-children",
    selector:
      "JSXElement[openingElement.name.name='Trans'] > :matches(JSXText[value=/\\S/], JSXExpressionContainer, JSXElement)",
    message:
      'No children in <Trans>: the text lives in src/locales/en/translation.json. Use <Trans i18nKey="..." components={...} />, or t(key).',
  },
  {
    // A form validates with one zod schema (make<Form>Schema(t), shared pieces in util/formSchemas),
    // so its messages and rules are not rewritten as rule functions in every dialog. See AGENTS.md "Forms".
    id: "form-validate-object",
    selector:
      "CallExpression[callee.name='useForm'] > ObjectExpression > Property[key.name='validate'] > ObjectExpression",
    message: "Validate with schemaResolver(make<Form>Schema(t), { sync: true }) and a zod schema, not rule functions.",
  },
  {
    // Render errors in a feature are caught by the one FeatureBoundary (components/common/FeatureBoundary).
    id: "error-boundary",
    selector: "MethodDefinition[key.name='componentDidCatch']",
    message:
      "Wrap the feature in <FeatureBoundary> (components/common/FeatureBoundary) instead of a new error boundary.",
    allowIn: ["src/components/common/FeatureBoundary.tsx"],
  },
  {
    // Hover and focus effects are CSS (:hover, :focus-visible in a CSS module), not an event handler
    // that writes the element's style: React owns that attribute, and keyboard focus never sees it.
    id: "style-from-handler",
    selector:
      ":matches(AssignmentExpression[left.object.property.name='style'][left.object.object.property.name=/^(currentTarget|target)$/], CallExpression[callee.object.property.name='style'][callee.object.object.property.name=/^(currentTarget|target)$/])",
    message:
      "Style hover and focus in a CSS module (:hover, :focus-visible), not by writing event.currentTarget.style (AGENTS.md, Styling).",
  },
  {
    // The unknown group's name is one shared constant (also the backend's Person.UNKNOWN_PERSON_NAME);
    // a hand-typed copy drifts the day the name changes (#2236). Tests may spell out what the server sends.
    id: "unknown-person-literal",
    selector: "Literal[value='Unknown - Other']",
    message: "Use UNKNOWN_PERSON_NAME from @librephotos/api-client, not the literal name of the unknown group.",
    allowIn: TEST_FILES,
  },
  {
    // A `disabled` control fires no mouse or focus events, so a Tooltip around it never opens and the
    // reason it holds is lost (#2237). DisabledReason keeps the control focusable and shows the reason.
    id: "tooltip-disabled-control",
    selector:
      "JSXElement[openingElement.name.name=/^(Tooltip|DisabledReason)$/] > JSXElement > JSXOpeningElement > JSXAttribute[name.name='disabled']",
    message:
      "Wrap the control in <DisabledReason reason={...}> (components/common/DisabledReason) instead of a Tooltip around a disabled control.",
  },
  {
    // An ActionIcon holds only an icon, and a Tooltip is not an accessible name: a screen reader
    // announced such a button as just "button" (#2245). A decorative one is component="span".
    id: "action-icon-name",
    selector:
      "JSXOpeningElement[name.name='ActionIcon']:not(:has(JSXAttribute[name.name=/^aria-label(ledby)?$/])):not(:has(JSXAttribute[name.name='component'][value.value='span'])):not(:has(JSXSpreadAttribute))",
    message:
      'Name the ActionIcon with aria-label (the Tooltip text, or a shorter t() key); a Tooltip is not an accessible name. A decorative one is component="span".',
  },
  {
    // A `disabled` Menu.Item never says why, and Mantine's arrow keys skip it, so a keyboard user
    // never reaches it (#2592, #2608). DisabledReason keeps it in the arrow-key order with its reason.
    id: "menu-item-disabled",
    selector:
      "JSXOpeningElement[name.object.name='Menu'][name.property.name='Item'] > JSXAttribute[name.name='disabled']",
    message:
      "Wrap the Menu.Item in <DisabledReason reason={...}> (components/common/DisabledReason) instead of setting `disabled`: it says why and stays reachable with the arrow keys.",
  },
  {
    // A `disabled` button that opens a menu (the + of the selection toolbar, a split button's chevron)
    // never says why and drops out of the Tab order (#2621). DisabledReason around the Menu.Target says
    // why and keeps the menu shut. A Tooltip's own `disabled` (hidden while the menu is open) is fine.
    id: "menu-target-disabled",
    selector:
      "JSXElement[openingElement.name.object.name='Menu'][openingElement.name.property.name='Target'] > JSXElement > JSXOpeningElement:not([name.name='Tooltip']) > JSXAttribute[name.name='disabled']",
    message:
      "Wrap the Menu.Target in <DisabledReason reason={...}> (components/common/DisabledReason) instead of disabling its button: it says why and keeps the menu shut.",
  },
];

// Browser storage is read and written through util/storage, which owns the keys, the failure
// handling and the one-time move from an old key. Tests may set stored values up directly.
const storage = {
  message:
    "Use util/storage (readStored, writeStored or useStoredState) for browser storage; it owns the keys and the failure handling.",
  allowIn: ["src/util/storage.ts", "**/*.test.{ts,tsx}"],
};
// Components talk through props or the lightbox commands (components/lightbox/lightboxCommands),
// not through custom events on window.
const eventMessage =
  "Pass props or use the lightbox commands (components/lightbox/lightboxCommands) instead of custom window events.";

// Requests go through src/api_client: API calls through its client (401 policy, error handling,
// ApiError), media files through fetchMedia / probeMedia in api_client/media/mediaUrl.ts. Exempt: the
// token blacklist in api.ts (raw on purpose, so a failure cannot re-enter the 401 handler), the media
// module, util/dataUrl.ts (reads a data: URL, never the network) and tests, which stub fetch.
const rawFetch = {
  files: APP_FILES,
  message:
    "Request through src/api_client: a hook or function there for /api (on apiClient), fetchMedia/probeMedia (api_client/media/mediaUrl) for /media files.",
  allowIn: ["src/api_client/api.ts", "src/api_client/media/mediaUrl.ts", "src/util/dataUrl.ts", ...TEST_FILES],
};

// no-restricted-globals: `name`.
export const globalBans = [
  { id: "local-storage", name: "localStorage", ...storage },
  { id: "session-storage", name: "sessionStorage", ...storage },
  // A custom event is the in-app channel this is about, so it stays banned in tests too.
  { id: "custom-event", name: "CustomEvent", message: eventMessage },
  { id: "fetch", name: "fetch", ...rawFetch },
];

// no-restricted-properties: `object` and/or `property`.
export const propertyBans = [
  ...["window", "globalThis"].flatMap(object => [
    { id: `${object.toLowerCase()}-local-storage`, object, property: "localStorage", ...storage },
    { id: `${object.toLowerCase()}-session-storage`, object, property: "sessionStorage", ...storage },
    { id: `${object.toLowerCase()}-fetch`, object, property: "fetch", ...rawFetch },
  ]),
  {
    // Tests may dispatch a native event on window (a resize).
    id: "window-dispatch-event",
    object: "window",
    property: "dispatchEvent",
    message: eventMessage,
    allowIn: ["**/*.test.{ts,tsx}"],
  },
  {
    // Every request is an endpoint function in packages/api-client (parsed, typed, shared with
    // mobile); a web hook calls endpoints.<name>(apiClient, ...), never a method of the client.
    // Exempt: api.ts, which builds the client, and tests, which stub its methods.
    id: "api-client-method",
    files: APP_FILES,
    object: "apiClient",
    message:
      "Call endpoints.<name>(apiClient, ...) from @librephotos/api-client; add the endpoint and its schema there (AGENTS.md, API layer).",
    allowIn: ["src/api_client/api.ts", ...TEST_FILES],
  },
];

const banRules = [
  {
    bans: importBans,
    rule: tseslint.rules["no-restricted-imports"],
    options: item => ("group" in item || "regex" in item ? { patterns: [item] } : { paths: [item] }),
  },
  { bans: syntaxBans, rule: builtinRules.get("no-restricted-syntax"), options: item => item },
  { bans: globalBans, rule: builtinRules.get("no-restricted-globals"), options: item => item },
  { bans: propertyBans, rule: builtinRules.get("no-restricted-properties"), options: item => item },
];

/** One plugin that holds a rule per ban, then one config block per ban with its own files/allowIn. */
function banConfigs() {
  const rules = {};
  const blocks = [];
  for (const { bans, rule, options } of banRules) {
    for (const { id, files = TS_FILES, allowIn, ...item } of bans) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id in rules) {
        throw new Error(`eslint.config.mjs: ban id "${id}" must be unique and kebab-case`);
      }
      rules[id] = rule;
      blocks.push({
        name: `ban/${id}`,
        files,
        ...(allowIn ? { ignores: allowIn } : {}),
        rules: { [`ban/${id}`]: ["error", options(item)] },
      });
    }
  }
  return [{ name: "ban/plugin", plugins: { ban: { meta: { name: "ban" }, rules } } }, ...blocks];
}

// ---------------------------------------------------------------------------------------------------
// Size (AGENTS.md): an app source file has at most SIZE_LIMITS.lines lines and a function at most
// SIZE_LIMITS.function, blank lines and comments not counted. A file that was over when the limits came
// in is listed in eslint-size-baseline.json with its measured size, which becomes its own limit: it
// can shrink, never grow. eslint.config.test.mjs fails while an entry is above the file's real size,
// and `UPDATE_SIZE_BASELINE=1 yarn test eslint.config.test.mjs` lowers it (and drops the entry once
// the file is under the default). Nothing ever adds an entry: extract before you add.
// ---------------------------------------------------------------------------------------------------

export const SIZE_LIMITS = { lines: 400, function: 250 };
export const SIZE_FILES = ["src/**/*.{ts,tsx}"];
export const SIZE_IGNORES = [...TEST_FILES, "src/routeTree.gen.ts"];
export const SIZE_BASELINE_PATH = new URL("./eslint-size-baseline.json", import.meta.url);
/** `{ "src/...": { lines?: number, function?: number } }`, largest file first. */
export const sizeBaseline = JSON.parse(readFileSync(SIZE_BASELINE_PATH, "utf8"));

const sizeRule = max => ["error", { max, skipBlankLines: true, skipComments: true }];

function sizeConfigs() {
  return [
    {
      name: "size/limits",
      files: SIZE_FILES,
      ignores: SIZE_IGNORES,
      rules: {
        "max-lines": sizeRule(SIZE_LIMITS.lines),
        "max-lines-per-function": sizeRule(SIZE_LIMITS.function),
      },
    },
    ...Object.entries(sizeBaseline).map(([file, size]) => ({
      name: `size/baseline/${file}`,
      files: [file],
      rules: {
        ...(size.lines ? { "max-lines": sizeRule(size.lines) } : {}),
        ...(size.function ? { "max-lines-per-function": sizeRule(size.function) } : {}),
      },
    })),
  ];
}

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
      "react/jsx-key": ["error", { checkFragmentShorthand: true }],
      "react/no-array-index-key": "error",
      "react/jsx-no-useless-fragment": "error",

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
    files: TS_FILES,
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

      // Every promise is awaited, returned or discarded with `void`; an event prop gets a sync
      // function (`onClick={() => void navigate(...)}`). Existing findings sit in
      // eslint-suppressions.json and are burned down per directory; never add to it.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // A switch over a union names every member, or its default asserts `never`.
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: false }],
      // `type`, not `interface`; `import type` for type-only imports.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // `typeof import("...")` stays allowed: it is how vi.mock factories type importOriginal.
      "@typescript-eslint/consistent-type-imports": ["error", { disallowTypeAnnotations: false }],
    },
  },
  {
    // An async function without `await`. Off in test code, where async mocks and test bodies are
    // the norm and the rule finds nothing worth fixing.
    files: TS_FILES,
    ignores: TEST_FILES,
    rules: {
      "@typescript-eslint/require-await": "error",
    },
  },
  {
    // React Query: every value a queryFn reads is part of its key (a factory call's arguments count),
    // and a whole query result never goes into a hook's deps.
    files: TS_FILES,
    plugins: { "@tanstack/query": pluginQuery },
    rules: {
      "@tanstack/query/exhaustive-deps": "error",
      "@tanstack/query/no-unstable-deps": "error",
    },
  },
  ...banConfigs(),
  {
    // Accessible names (#2245): an image has alt text (alt="" when it is decorative), a link has
    // content, and a control has a text label. The plugin sees Mantine's components as the elements
    // they render (and `component="..."` on the polymorphic ones). A childless capitalised component
    // inside a control counts as a label to the plugin, unless it matches controlComponents: Icon*
    // keeps a Tabler icon from naming its button. Test mocks render bare controls on purpose.
    name: "a11y/names",
    files: ["src/**/*.tsx"],
    ignores: TEST_FILES,
    plugins: { "jsx-a11y": jsxA11y },
    settings: {
      "jsx-a11y": {
        polymorphicPropName: "component",
        polymorphicAllowList: ["Box", "UnstyledButton", "Badge", "Anchor", "Button", "ActionIcon"],
        components: {
          ActionIcon: "button",
          Button: "button",
          CloseButton: "button",
          UnstyledButton: "button",
          Image: "img",
          Anchor: "a",
        },
      },
    },
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      // The element and role lists are the plugin's documented defaults for this rule: a media or
      // canvas element and a composite widget get their name elsewhere.
      "jsx-a11y/control-has-associated-label": [
        "error",
        {
          controlComponents: ["Icon*"],
          depth: 4,
          ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
          ignoreRoles: [
            "grid",
            "listbox",
            "menu",
            "menubar",
            "radiogroup",
            "row",
            "tablist",
            "toolbar",
            "tree",
            "treegrid",
          ],
          includeRoles: ["alert", "dialog"],
        },
      ],
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
  ...sizeConfigs(),
  {
    // A route file renders one component; anything else it needs lives under components/ (AGENTS.md).
    name: "routes/one-component",
    files: ["src/routes/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    // The plugin's component detection cannot "detect" the React version under ESLint 10 (it calls the
    // removed context.getFilename()), so it gets the installed version.
    settings: { react: { version: createRequire(import.meta.url)("react/package.json").version } },
    rules: {
      "react/no-multi-comp": "error",
    },
  },
];
