# LibrePhotos web app

React 19 + TypeScript, Vite, TanStack Router (file routes in `src/routes`, `routeTree.gen.ts` is
generated) and TanStack Query, Mantine 9, i18next, zod. Node is the version in `.nvmrc`; Yarn 1.

## Commands

Run from `apps/frontend`:

- `yarn install --frozen-lockfile`
- `yarn lint:error`: ESLint over src, e2e and the config files, zero warnings (`--max-warnings 0`), Prettier included; unused or undescribed disable comments fail too
- `yarn format:check`: Prettier over this app and `packages/api-client` (one config, `prettier.config.cjs`); `yarn format` fixes. Non-English locales are ignored
- `yarn typecheck`: plain `tsc --noEmit` over `src/` (`tsconfig.json`) and `vite.config.ts` (`tsconfig.node.json`). Zero errors, no baseline; any error fails
- `yarn typecheck:e2e`: `tsc --noEmit` over the Playwright suite (`e2e/tsconfig.json`); needs `e2e/` dependencies installed
- `yarn knip`: unused dependencies, files and exports (`knip.json`), zero findings
- `yarn test`: vitest (includes `src/fileNames.test.ts`, the file-name rule)
- `yarn build`, `yarn start`

CI (`lint-frontend.yml`, `typecheck-frontend.yml`) runs the same scripts, so a green local run means a
green CI run. To develop against a local backend, copy `.env.development.example` to
`.env.development` and set `VITE_BACKEND_URL`; Vite proxies `/api` and `/media`.

## Rules

- No `any`, written or inherited (`JSON.parse`, an untyped mock, a catch-all prop), and no assertion
  that claims more than the value is, `!` included. Narrow unknown data with a type guard or parse it
  with its zod schema. In tests, use `defined()` from `src/util/defined.test-utils.ts` when a value
  must be there.
- Type mocks: `vi.fn<(arg: T) => R>()` or `vi.fn(implementation)`, never a bare `vi.fn()`.
- Size: a file in `src` has at most 400 lines and a function at most 250, blank lines and comments not counted (`max-lines`, `max-lines-per-function`; tests exempt), and a route file renders one component (`react/no-multi-comp`): everything else lives under `components/`. A file over a limit is in `eslint-size-baseline.json` at its measured size, so it can shrink but not grow: extract before you add to it, and never add an entry. After shrinking one, run `UPDATE_SIZE_BASELINE=1 yarn test eslint.config.test.mjs` and commit the JSON (the test fails while it is stale).
- File names have no dashes or underscores (`src/fileNames.test.ts` fails on them). Components are `PascalCase.tsx`, hooks `useX.ts(x)`, other modules `camelCase.ts`; route files follow TanStack's `$param`/`_layout` syntax. Import lodash from `lodash-es` (lint bans `lodash`; the package is not a dependency).
- Knip (`yarn knip`) runs in CI: an unused dependency, file or export fails it. Delete the code or drop the `export`; do not add a dependency nothing imports.
- Toasts go through `notification.success|error|warning|hide` from `src/service/notifications`, never
  `@mantine/notifications` (lint bans it; the colours live in `toast.ts`). A message shown from two
  places gets a named helper there.
- No `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; fix the type.
- Every promise is awaited, returned or discarded with `void`. In a mutation's `onSuccess`/`onSettled`,
  return the invalidation (`Promise.all` for several) when the UI should wait for fresh data, `void` it
  when it should not. Event props get a sync function: `onClick={() => void navigate(...)}`. Old findings
  sit in `eslint-suppressions.json` (ESLint bulk suppressions): never add to it to get a PR green; after
  fixing some, run eslint with `--prune-suppressions`, since a stale entry fails the lint.
- A `switch` over a union names every member (a `default` does not count). `type`, not `interface`
  (module augmentation excepted); `import type` for type-only imports. No `console.log`, `.debug` or
  `.info`; `console.warn`/`console.error` stay until there is an error reporter.
- A new "use X, not Y" convention is one entry in `importBans`, `syntaxBans`, `globalBans` or
  `propertyBans` in `eslint.config.mjs` (with `allowIn` for the module that owns Y) plus its planted
  violation in `eslint.config.test.mjs`; never set a `no-restricted-*` rule in a config block. Each entry
  becomes its own rule `ban/<id>`, so one ban's exemption cannot drop another.
- `tsconfig.json` is strict with `noImplicitReturns`, `noImplicitOverride` and `noUncheckedIndexedAccess`
  (an index read is `T | undefined`: guard it, use `?.`, or `defined()` in tests). `allowJs` is off.
- Dates: parse and format only through `src/util/dateUtils.ts` (luxon). Pick the parser by what the value is: `parsePhotoTimestamp` for an `exif_timestamp` (wall clock tagged UTC), `parseInstant` for a real instant, `fromUnixSeconds` for epoch seconds, the picker helpers for DateTimePicker values. No `.setLocale()`: the UI language is luxon's default, set in `i18n.ts`. dayjs is only Mantine's picker glue. The `ban/date-*` and `ban/dayjs` lint rules enforce it.
- Server data goes through the API layer (see "API layer" below), not components. A component, route,
  `hooks/` or `util/` module never fetches: add a hook or function in `src/api_client/<domain>` (lint bans
  `fetch` and importing `apiClient` outside the API layer). Media URLs come from `mediaUrl` and media files from
  `fetchMedia`/`probeMedia` (`src/api_client/media/mediaUrl.ts`, `ban/media-url` on a `/media/` string), so
  paths, cookies and errors are handled in one place.
- React Query keys come from the domain's factory in `src/api_client/<domain>/keys.ts`, and every photo grid's
  from `photoGridKeys` (root `["photoGrid"]`): add the key to the factory, invalidate by prefix
  (`photoGridKeys.all` refreshes every grid), never write a key literal (`ban/query-key-literal`); every value
  a `queryFn` reads goes into the key (`@tanstack/query/exhaustive-deps`). Hooks get the client from
  `useQueryClient()`; the `queryClient` singleton is for `api_client/api.ts` and `index.tsx` (`ban/query-client-singleton`).
- Cookies go through `src/api_client/authCookies.ts` (`getAuthCookie`, `setAuthCookie`, `clearAuthCookies`),
  which gives them their flags (path `/`, SameSite=Lax, Secure on HTTPS); lint bans `react-cookie` elsewhere.
  The `jwt` cookie is HttpOnly and the server clears it on logout (`/api/auth/token/blacklist/`).
- Follow a job or wait on a condition with `pollWhile`, `pollUntil` or `invalidateAfter` from
  `@librephotos/api-client` (`packages/api-client/src/polling.ts`), with a `POLL_*_MS` name for the
  interval. Lint bans a number in `refetchInterval`/`pollingInterval` and a raw `setTimeout`/`setInterval`
  in `src/api_client` and `packages/api-client` (the polling module is the one place that sets timers).
- A list the UI shows whole is read with `fetchAllPages(client, endpoint)` from `@librephotos/api-client`
  (`packages/api-client/src/transport/pages.ts`), which follows the server's `next` links; parse its rows with
  the list's zod schema. Reading one page of a paginated list drops every row past it (backend
  `api/drf/pagination.py`). Page envelopes spread `PageFields` from the package's `schemas/common.ts`.
- A failed request rejects with `ApiError`: branch on its `status` or `serverCode` (the backend's
  `errors[0].code`), never on message text; show only `serverMessage`, never `message`.
- `packages/api-client` runs on this app's zod and React Query (`resolve.dedupe`, tsconfig `paths`) and on the mobile app's: shared schemas use zod 4 APIs only, and a zod or React Query bump here moves `apps/mobile`, the package and the root `package.json` too (`scripts/check-shared-deps.mjs` fails otherwise). `yarn test` runs the package's suite as the `api-client` vitest project.
- A response schema in `packages/api-client` is listed in `src/__tests__/contract-map.ts` with its OpenAPI component (or in `UNMAPPED` with the reason), and `openapi.contract.test.ts` compares the two (field names, required, nullability, types) against `apps/backend/openapi.json`. A difference fails unless `contract-baseline.json` lists it with a reason; that file only shrinks. Optional-for-older-servers is allowed and needs no entry.
- An integer id that a server sends, or once sent, as a string is read with `IntegerId` from `packages/api-client/src/schemas/common.ts`, which always gives a number, so ids from different responses compare and key alike. The contract test reports a server `id` that is a non-UUID string, or an `IntegerId` field the schema types as a string, as `string-id`.
- User-visible text uses `t()` with a key in `src/locales/en/translation.json`: add the English string
  there first. Never edit the other locales; Weblate fills them in.
- Translation keys are type-checked against the English file (`src/@types/i18next.d.ts`), so `t()` takes
  a key literal, never a `string`. A key picked at runtime comes from a typed map
  (`Partial<Record<Value, ParseKeys>>`, e.g. `components/job/jobTypeLabel.ts`, with a fallback for a value
  the map lacks) or a template literal over a union type. No English defaults (`t(key, "Text")`,
  `defaultValue`) and no children in `<Trans>` (`ban/t-default*`, `ban/trans-children`).
  `src/i18n.keys.test.ts` fails on an English key no source file uses; `src/locales/unusedKeysBaseline.txt`
  only shrinks.
- Every page header is `components/PageHeader` (the page's one `h1`); `PageHeader.test.tsx` fails on any other `order={1}` or `<h1` in source.
- Dialogs are components: a `*Modal.tsx` with `opened` and `onClose` props (under `components/modals` when shared, next to its feature otherwise), opened by its parent with `useDisclosure` from `@mantine/hooks`. Lint bans `<Modal` in `src/routes`, `useState` for open state and `@mantine/modals`, so there is one way to open a dialog.
- Forms: a component that collects input and submits it uses `useForm` from `@mantine/form` with `validate: schemaResolver(make<Form>Schema(t), { sync: true })`, the zod schema in a `<Form>.schema.ts` next to it (`-<form>.schema.ts` in `src/routes`). The factory takes `t`, so every message is translated text. Shared rules live in `util/formSchemas.ts` (`email`/`optionalEmail` on `z.email()`, never a regex; `uniqueName` for a trimmed, case-insensitive name clash, `newName` for a person/album/tag name; `withMatchingPasswords`; `withNewPassword` for `settings/PasswordEntry`, whose fields belong to the parent form). An external check (a picker's path validity) is a factory argument; an async one (name availability) feeds `form.setFieldError`. Lint bans an object of rule functions in `validate`, and `src/architecture/forms.test.ts` fails on a `useState` form: one with a submit button, or a `useState` input with an `error` or a Button `disabled` by its value.
- Persist UI state with `useStoredState` (or `readStored`/`writeStored`) from `util/storage`, with a key in `STORAGE_KEYS`; the key is versioned, and a change of shape moves the old value across. Lint bans `localStorage` and `sessionStorage` everywhere else, because every other read has to be the one that survives a corrupt value.
- Components talk through props or context (the lightbox's `useLightboxCommands`), not `window` custom events: lint bans `CustomEvent` and `window.dispatchEvent`, since any listener on the page would receive them.
- Loading and errors: a page or section's first load is `src/components/common/PageLoader.tsx` (a refetch keeps an inline `<Loader size="xs" />`), no data is `EmptyState`, and a component that wraps a third-party renderer (lightbox, maps, statistics charts) puts `FeatureBoundary.tsx` inside itself so its render error does not replace the page. Lint bans a returned `<Loader />`, `Center`/`Stack` + `Loader` and `componentDidCatch` outside those two files.
- Lists and grids: photo layouts render through `components/photolist/PhotoListView` (react-pig is its engine) and fixed-size tiles through `components/virtual/TileGrid` (the faces grid on `VirtualGrid` is the one exception); lint bans other imports of react-pig, `@tanstack/react-virtual` and `VirtualGrid`, and `rowIndex *` cell math. A plain `.map()` is only for a list bounded by a server page size or a hard cap of at most 100 items; anything that grows with the library uses one of the two, or a long list mounts thousands of nodes.

## API layer

- Decided in #2347: `packages/api-client` owns every request. One endpoint function per call in
  `packages/api-client/src/endpoints` parses the answer with its zod schema (`src/schemas`) and returns
  the parsed type, so web and mobile share one typed copy. `src/api_client/<domain>` keeps thin hooks:
  `useQuery`/`useMutation` around `endpoints.<name>(apiClient, ...)`, keys from `keys.ts`, invalidation
  and toasts; its `types.ts` only re-exports package types.
- A new call: schema (plus its `contract-map.ts` entry), endpoint and a fixture test in
  `packages/api-client/src/__tests__`, then the hook. Run the package's and `apps/mobile`'s checks too: the
  package ships to mobile. A parse failure throws `ResponseParseError`, which the QueryClient in `api.ts`
  reports, so a hook adds no parse handling of its own.
- Lint: `ban/api-client-method` (an `apiClient.<method>` call outside `api.ts` and tests), `ban/api-client-zod`
  and `ban/api-client-zod-utils` (zod or `util/zodUtils` in `src/api_client`). Domains not moved yet sit in
  `eslint-suppressions.json`, which only shrinks. `endpointReturnTypes.test.ts` in the package fails on an
  endpoint returning `Promise<unknown>`; its allow-list only shrinks.

## Styling

- Colours come from the theme so dark mode works: Mantine colour props (`c`, `color`, `bg`), `var(--mantine-color-*)`, and `light-dark()` when a value differs per scheme. Deliberate non-theme colours have one home each: chart palettes in `src/theme/chartColors.ts`, map layer colours in `src/theme/mapColors.ts`, the gradient buttons in `src/theme/brandGradients.ts`, and CSS variables in `src/theme/colors.css`: neutral black/white shades for scrims, borders and shadows (`--app-scrim-black-30` is black at 30 % opacity; add a step there rather than writing `rgba()`) and a few named accents.
- Static styling is Mantine style props or a CSS module (`Foo.module.css` next to the component); `style={{}}` is for values computed at runtime. Hover and focus are CSS (`:hover`, `:focus-visible`), never a handler that writes `style` (lint: `ban/style-from-handler`). No `!important` and no global component stylesheet: global CSS is only `App.module.css` and the theme setup in `src/index.tsx`.
- Mantine style props take any string, so a typo or wrong value fails silently: check a converted component's computed styles in light and dark.
- `src/architecture/styles.test.ts` counts colour literals, `!important`, global stylesheet imports and `style={{` per file against `src/architecture/stylesBaseline.json`. A file may not go above its count and a new file starts at zero. The baseline only shrinks: after lowering a count, run `UPDATE_STYLES_BASELINE=1 yarn test src/architecture/styles.test.ts` and commit the JSON (the test fails while it is stale).
