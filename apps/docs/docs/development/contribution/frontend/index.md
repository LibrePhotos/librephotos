---
title: "👨‍💻 Frontend"
description: "Development Information regarding LibrePhotos Frontend."
sidebar_position: 2
last_modified_at: 2026-09-26
---

The frontend is a [React 18](https://react.dev/) single-page app, written in TypeScript and built
with [Vite](https://vite.dev/). [Mantine](https://mantine.dev/) provides the UI components,
[TanStack Router](https://tanstack.com/router) handles routing, and
[TanStack Query](https://tanstack.com/query) handles server state.

The full tech stack, the development commands (`yarn start`, `yarn test`, `yarn build`) and the code
style conventions are documented in
[apps/frontend/README.md](https://github.com/LibrePhotos/librephotos/blob/dev/apps/frontend/README.md),
which lives next to the code. Please read that first — this page only covers what it does not:
debugging, and how the source tree is laid out.

## ✨ Code Standards

We use ESLint and Prettier to keep our code tidy. Before you commit, run `yarn lint:error` to check
your changes and `yarn lint:error:fix` to apply the automatic fixes — the ESLint config enforces
Prettier through the `prettier/prettier` rule, so linting also flags unformatted code. The
`lint-frontend` CI workflow runs the lint, test and build steps on every pull request that touches
`apps/frontend` and fails on anything unclean, so nothing un-linted gets merged.

`yarn build` does not type-check, so run `yarn typecheck` as well. It runs `tsc --noEmit` and
compares the errors against `apps/frontend/tsc-baseline.txt`, the backlog of errors that predate the
check. Any error that is not in the baseline fails it, and so does the `typecheck-frontend` CI
workflow. Errors are matched by file, code and message, not by line, so moving existing code around
is fine. When you fix baseline errors the check tells you so; run `yarn typecheck:update` and commit
the smaller baseline. Don't use `typecheck:update` to accept new errors — fix them instead.

The repository ships a `husky` pre-commit hook (`apps/frontend/.husky/pre-commit`, which runs
`lint-staged`), but it is currently inactive in the monorepo: `yarn install` runs the `prepare`
script — `husky` — with the working directory set to `apps/frontend`, which has no `.git` of
its own, so husky exits without registering the hook. Don't rely on it; lint before you commit.

## 🧪 End-to-end tests {#end-to-end-tests}

`apps/frontend/e2e` holds a [Playwright](https://playwright.dev/) smoke suite: log in, the timeline
shows photos, the lightbox opens, a favorite toggles and persists, log out. It has its own
`package.json`, separate from the app's. The `e2e` workflow runs it nightly, on demand, and on pull
requests labelled `e2e`, and uploads the Playwright report, traces and container logs when it fails.

**Against the Docker e2e stack** (what CI does). `deploy/compose/docker-compose.e2e.yml` builds the
proxy, frontend and backend from your checkout, creates `admin`/`admin` and scans the eight sample
photos in `deploy/e2e/photos`:

```bash
docker compose -f deploy/compose/docker-compose.e2e.yml up -d --build --wait
cd apps/frontend/e2e
yarn install
yarn playwright install chromium
yarn test                     # or `yarn test:ui` for the interactive runner
docker compose -f ../../../deploy/compose/docker-compose.e2e.yml down -v
```

**Against a native stack** (no Docker, see
[Native Windows Setup](/docs/development/dev-install#native-windows-setup-no-docker)). Use a fresh
data directory and an `admin`/`admin` account, copy `deploy/e2e/photos` to `<DataDir>\data\e2e` (it
has to be inside the backend's data root), then point the suite at the Vite dev server and that folder:

```powershell
$env:E2E_BASE_URL = "http://localhost:3000"
$env:E2E_SCAN_DIR = "C:\librephotos-devdata\data\e2e"
yarn test
```

The setup step sets the admin's scan directory and starts a scan when the account has no photos yet.
A scan started this way first downloads the ML models (about 1.3 GB, once). The specs expect exactly
the sample library, so run them against an account with no other photos. `E2E_USERNAME` and
`E2E_PASSWORD` override the credentials.

## 🐛 Debugging

### React Debug Tool

React provides a debug tool, which you can download
[here](https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi).

### WDYR

[WDYR](https://github.com/welldone-software/why-did-you-render) explains to you why a component
re-rendered, by logging the changed props and hooks to the browser console. It is wired up in
[src/wdyr.ts](https://github.com/LibrePhotos/librephotos/blob/dev/apps/frontend/src/wdyr.ts) and only
runs in development builds.

Set `VITE_APP_WDYR` to the literal string `true` — any other value (`True`, `1`, unset) leaves it
off. Where you set it depends on how you run the frontend:

- **Local dev server** (`yarn start`) — add `VITE_APP_WDYR=true` to `apps/frontend/.env.development`.
- **Docker dev stack** — add `VITE_APP_WDYR=true` to `deploy/compose/.env`, then recreate the
  container so it picks up the new environment:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d frontend
  ```

Either way the dev server has to be restarted. WDYR needs its own JSX transform, which
`vite.config.ts` only selects when the variable is set at startup, so flipping it mid-session has no
effect.

### REST API

Our REST API is documented with [Swagger](https://swagger.io/) and
[ReDoc](https://redocly.github.io/redoc/). Once your development stack is up, both are served from
the running instance — see [Development Installation](/docs/development/dev-install) for the URLs.

## 🏙️ Structure

Everything below is relative to
[apps/frontend/src](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src).

- [routes](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/routes) holds the
  pages. Routing is file-based: the path of a file determines its URL. Routes under `_protected`
  require a logged-in user, routes under `public` do not, and `__root.tsx` is the shell they all
  render into. `routeTree.gen.ts` is generated from this folder by the TanStack Router plugin —
  never edit it by hand.
- Pages should be split up into React components, which you can find in
  [components](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/components),
  grouped by feature.
- [api_client](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/api_client)
  is the API layer. `api.ts` defines `FetchClient`, a small wrapper around `fetch` that attaches the
  access token and transparently refreshes it on a 401. Around it, one folder per domain (`photos`,
  `albums`, `faces`, …) exports the TanStack Query hooks the components actually call, named
  `useFetch…Query` and `use…Mutation`.
- [hooks](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/hooks) and
  [service](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/service) contain
  cross-cutting hooks and helpers, such as authentication and notifications.
- [locales](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/locales) holds the
  translations, set up in `i18n.ts`. Translations are contributed through
  [Weblate](https://hosted.weblate.org/engage/librephotos/) rather than edited directly.
- In [util](https://github.com/LibrePhotos/librephotos/tree/dev/apps/frontend/src/util) you can find
  miscellaneous functions.
