# LibrePhotos Monorepo — Agent Guidelines

This is a monorepo. Each app has its own stack, test runner, and conventions — be aware of which app you are working in.

## Layout

```
apps/
├── backend/   Django 5 + Postgres + django-q2. See apps/backend/CLAUDE.md for backend-specific commands.
├── frontend/  React 18 + Vite + TanStack + Mantine + i18next. Yarn.
├── mobile/    React Native. Yarn. Android-focused.
└── docs/      Docusaurus 2. Yarn. Deployed to docs.librephotos.com via GitHub Pages.
deploy/
├── docker/    Dockerfiles and entrypoints for backend, backend-gpu, frontend, proxy, unified.
├── compose/   docker-compose.yml, docker-compose.dev.yml, docker-compose.e2e.yml, librephotos.env.
├── k8s/       Kubernetes manifests.
└── proxy/     Reverse proxy config.
```

## Working across apps

- **Always specify the app path.** `apps/backend/manage.py`, not `manage.py`.
- **Cross-app PRs are fine**, e.g. a backend API change plus the frontend client update. Keep them scoped to the single feature.
- **CI is path-filtered.** Touching `apps/frontend/` only runs the frontend pipeline. Touching `apps/backend/` and `deploy/docker/backend/` runs backend lint plus the backend image build.

## Commands (summary — see per-app CLAUDE.md for details)

### Backend (apps/backend/)
- Lint: `ruff check apps/backend/` • Format: `ruff format apps/backend/`
- Test: `cd apps/backend && python manage.py test api.tests`
- Normally run inside the backend container: `docker exec -it backend bash`.

### Frontend (apps/frontend/)
- Install: `cd apps/frontend && yarn install --legacy-peer-deps`
- Lint: `yarn lint:error` • Test: `yarn test` • Build: `yarn build`
- Dev server: `yarn start`

### Mobile (apps/mobile/)
- Install: `cd apps/mobile && yarn install`
- Lint: `yarn lint`
- Android build: `cd android && ./gradlew assembleRelease`

### Docs (apps/docs/)
- Install: `cd apps/docs && yarn install --frozen-lockfile`
- Local: `yarn start` • Build: `yarn build`

## History & tags

- All 5 source repos were imported with `git filter-repo --to-subdirectory-filter` — `git log --follow apps/<app>/<file>` preserves full history.
- Tags are namespaced: `backend/`, `frontend/`, `mobile/`, `docker/`, (no `docs/` tags existed in the source repo).

## Localization

Frontend strings live in `apps/frontend/src/locales/<lang>/translation.json` and are translated via Weblate (https://hosted.weblate.org/engage/librephotos/). Do not hand-edit non-English JSONs — change English, then let translators catch up.
