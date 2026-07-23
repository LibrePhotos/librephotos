---
title: "👨‍💻 Frontend"
excerpt: "Development Information regarding LibrePhotos Frontend."
last_modified_at: 2026-07-22
category: 5
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

We use ESLint and Prettier to keep our code tidy. Running `yarn install` also installs the git hooks
(the `prepare` script runs `husky install`), so staged files are formatted and linted on every
commit — there is no extra setup step.

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
