# LibrePhotos

A self-hosted photo manager. This is a monorepo; each app has its own stack and its own
`AGENTS.md`. Read the one for every app you change.

| Path | What | Guide |
| --- | --- | --- |
| `apps/backend` | Django 5.2 + DRF, django-q2 jobs, ONNX sidecars | `apps/backend/AGENTS.md` |
| `apps/frontend` | React 19, Vite, TanStack Router/Query, Mantine 9, i18next | `apps/frontend/AGENTS.md` |
| `apps/mobile` | Expo SDK 57, offline-first sync | `apps/mobile/AGENTS.md` |
| `packages/api-client` | Shared zod schemas and endpoints (mobile, partly web) | |
| `apps/docs` | Docusaurus 3, deployed to docs.librephotos.com from `dev` | |
| `deploy/` | Dockerfiles, compose, k8s, e2e setup | |

## Rules

- A user-facing feature, setting or env var ships with its docs in `apps/docs` in the same PR.
  Docs deploy from `dev` before a release, so say when something is not released yet.
- Edit only English strings (`apps/frontend/src/locales/en`). Weblate owns the other languages.
- Make checks pass by fixing the code. Adding `any`, `# type: ignore`, `eslint-disable` or a
  baseline entry to get green is not a fix. The frontend has no baseline (its `tsc` reports zero
  errors); the backend mypy baseline only shrinks.
- CI is path-filtered, so a PR only runs the pipelines of the apps it touches. Run the checks of
  every app you changed before pushing, including `packages/api-client` when mobile or web use it.
- A cross-app PR is fine when one feature needs it (API change plus client). Keep a PR to one concern.
- New convention? Enforce it with a lint rule, test or CI step, then add one line to the relevant
  `AGENTS.md`. Unenforced guidance drifts.
- Use the tool versions the repo pins: Node from `apps/frontend/.nvmrc`, ruff and mypy from
  `apps/backend/requirements.dev.txt`.

## Deploy

- `deploy/compose/docker-compose.yml` and `docker-compose.unified.yml` both read `librephotos.env`: a new backend
  variable goes into both compose files and `librephotos.env`, with the same `${key:-default}`
  (`apps/backend/api/tests/infra/test_compose_files_in_sync.py` fails otherwise). Build the unified image from the repo root.

## Commands

- Backend (`apps/backend`): `python manage.py test api.tests`, `ruff check .`, `ruff format .`,
  `python scripts/typecheck.py`, `python scripts/check_dead_code.py`. Details and the no-Docker
  setup: `apps/backend/AGENTS.md`.
- Frontend (`apps/frontend`): `yarn install`, `yarn lint:error`, `yarn format:check`, `yarn typecheck`
  (plain `tsc`, must report 0 errors), `yarn typecheck:e2e`, `yarn test`, `yarn build`, `yarn start`.
- Mobile: `npm ci` once at the repo root (the root `package-lock.json` is the only lockfile), then
  `npm run check --workspace apps/mobile`.
- API client (`packages/api-client`): `npm run typecheck|lint|test --workspace packages/api-client`
  (CI: `api-client.yml`). Its TypeScript, ESLint and vitest majors follow `apps/frontend`, which
  compiles it; its formatting is the web app's `yarn format:check`. No `package-lock.json` but the root one.
  Both apps run its schemas on their own zod 4, so use zod 4 APIs only (lint: `no-deprecated`), and
  bump zod or React Query in the web, mobile, package and root manifests together:
  `node scripts/check-shared-deps.mjs` (CI) fails on a peer-range or zod-major mismatch.
- Docs (`apps/docs`): `yarn install --frozen-lockfile`, `yarn build`.

## History

The five source repos were imported with `git filter-repo --to-subdirectory-filter`, so
`git log --follow apps/<app>/<file>` shows full history. Tags are namespaced (`backend/`,
`frontend/`, `mobile/`, `docker/`).
