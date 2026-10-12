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
- `yarn knip`: unused dependencies, files and exports (`knip.json`), zero findings. Its `ignoreIssues` entry is the one deliberate alias (`api_client/api.ts`)
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
- File names have no dashes or underscores (`src/fileNames.test.ts` fails on them). Components are `PascalCase.tsx`, hooks `useX.ts(x)`, other modules `camelCase.ts`; route files follow TanStack's `$param`/`_layout` syntax. Import lodash from `lodash-es` (lint bans `lodash`; the package is not a dependency).
- Knip (`yarn knip`) runs in CI: an unused dependency, file or export fails it. Delete the code or drop the `export`; do not add a dependency nothing imports.
- Toasts go through `notification.success|error|warning|hide` from `src/service/notifications`, never
  `@mantine/notifications` (lint bans it; the colours live in `toast.ts`). A message shown from two
  places gets a named helper there.
- No `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; fix the type.
- `tsconfig.json` is strict with `noImplicitReturns`, `noImplicitOverride` and `noUncheckedIndexedAccess`
  (an index read is `T | undefined`: guard it, use `?.`, or `defined()` in tests). `allowJs` is off.
- Dates: parse and format only through `src/util/dateUtils.ts` (luxon). Pick the parser by what the value is: `parsePhotoTimestamp` for an `exif_timestamp` (wall clock tagged UTC), `parseInstant` for a real instant, `fromUnixSeconds` for epoch seconds, the picker helpers for DateTimePicker values. No `.setLocale()`: the UI language is luxon's default, set in `i18n.ts`. dayjs is only Mantine's picker glue. `no-restricted-syntax` and `no-restricted-imports` in `eslint.config.mjs` enforce it.
- Server data goes through `src/api_client` (and, where a domain has moved, `packages/api-client`):
  requests, zod schemas and React Query hooks live there, not in components.
- Cookies go through `src/api_client/authCookies.ts` (`getAuthCookie`, `setAuthCookie`, `clearAuthCookies`),
  which gives them their flags (path `/`, SameSite=Lax, Secure on HTTPS); lint bans `react-cookie` elsewhere.
  The `jwt` cookie is HttpOnly and the server clears it on logout (`/api/auth/token/blacklist/`).
- Follow a job or wait on a condition with `pollWhile`, `pollUntil` or `invalidateAfter` from
  `src/api_client/polling.ts`, with a `POLL_*_MS` name for the interval. Lint bans a number in
  `refetchInterval`/`pollingInterval` and a raw `setTimeout`/`setInterval` in `src/api_client`.
- A failed request rejects with `ApiError`: branch on its `status` or `serverCode` (the backend's
  `errors[0].code`), never on message text; show only `serverMessage`, never `message`.
- User-visible text uses `t()` with a key in `src/locales/en/translation.json`. Never edit the other
  locales; Weblate fills them in.
- Colours come from the Mantine theme or CSS variables so dark mode works.
- Every page header is `components/PageHeader` (the page's one `h1`); `PageHeader.test.tsx` fails on any other `order={1}` or `<h1` in source.
- Dialogs are components: a `*Modal.tsx` with `opened` and `onClose` props (under `components/modals` when shared, next to its feature otherwise), opened by its parent with `useDisclosure` from `@mantine/hooks`. Lint bans `<Modal` in `src/routes`, `useState` for open state and `@mantine/modals`, so there is one way to open a dialog.
- Persist UI state with `useStoredState` (or `readStored`/`writeStored`) from `util/storage`, with a key in `STORAGE_KEYS`; the key is versioned, and a change of shape moves the old value across. Lint bans `localStorage` and `sessionStorage` everywhere else, because every other read has to be the one that survives a corrupt value.
- Components talk through props or context (the lightbox's `useLightboxCommands`), not `window` custom events: lint bans `CustomEvent` and `window.dispatchEvent`, since any listener on the page would receive them.
- Loading and errors: a page or section's first load is `src/components/common/PageLoader.tsx` (a refetch keeps an inline `<Loader size="xs" />`), no data is `EmptyState`, and a component that wraps a third-party renderer (lightbox, maps, statistics charts) puts `FeatureBoundary.tsx` inside itself so its render error does not replace the page. Lint bans a returned `<Loader />`, `Center`/`Stack` + `Loader` and `componentDidCatch` outside those two files.
