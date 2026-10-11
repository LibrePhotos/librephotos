# LibrePhotos web app

React 19 + TypeScript, Vite, TanStack Router (file routes in `src/routes`, `routeTree.gen.ts` is
generated) and TanStack Query, Mantine 9, i18next, zod. Node is the version in `.nvmrc`; Yarn 1.

## Commands

Run from `apps/frontend`:

- `yarn install --frozen-lockfile`
- `yarn lint:error`: ESLint, which also enforces Prettier (`prettier/prettier`)
- `yarn typecheck`: `tsc --noEmit` against `tsc-baseline.txt`, which is empty; any error fails
- `yarn test`: vitest
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
- No `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; fix the type.
- Server data goes through `src/api_client` (and, where a domain has moved, `packages/api-client`):
  requests, zod schemas and React Query hooks live there, not in components.
- User-visible text uses `t()` with a key in `src/locales/en/translation.json`. Never edit the other
  locales; Weblate fills them in.
- Colours come from the Mantine theme or CSS variables so dark mode works.
