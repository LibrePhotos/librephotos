# Contributing to LibrePhotos

Thanks for your interest in contributing! This is a monorepo — contributions to any of the apps or to the deployment tooling live in this single repository. Open issues and pull requests here, not against the archived `librephotos-frontend`, `librephotos-docker`, `librephotos.docs`, or `librephotos-mobile` repositories.

## Where to Start

| You want to work on… | Go to |
|---|---|
| The Django API, ML pipelines, background jobs | [apps/backend/](apps/backend/) and [apps/backend/CONTRIBUTING.md](apps/backend/CONTRIBUTING.md) |
| The React web client | [apps/frontend/](apps/frontend/) and [apps/frontend/README.md](apps/frontend/README.md) |
| The React Native mobile client | [apps/mobile/](apps/mobile/) and [apps/mobile/README.md](apps/mobile/README.md) |
| The documentation site | [apps/docs/](apps/docs/) |
| Docker images, Compose configs, Kubernetes manifests | [deploy/](deploy/) |
| Translations | https://hosted.weblate.org/engage/librephotos/ |

## Dev Environment

The full stack (backend + frontend + db + proxy) runs via Docker Compose from [`deploy/`](deploy/). See the [development install guide](https://docs.librephotos.com/docs/development/dev-install) for step-by-step instructions.

Each app can also be worked on standalone:
- Backend: see [apps/backend/CONTRIBUTING.md](apps/backend/CONTRIBUTING.md)
- Frontend: `cd apps/frontend && yarn install && yarn start`
- Mobile: `cd apps/mobile && yarn install && yarn android`
- Docs: `cd apps/docs && yarn install && yarn start`

## Pull Requests

- **One PR, one concern.** Cross-app PRs (e.g. backend API change + frontend client update) are welcome and encouraged — that's a core reason for the monorepo — but unrelated changes should be separate PRs.
- **Target `dev`**, not `main`. `dev` is the default branch.
- **Conventional commit messages** are appreciated but not required.
- **CI runs path-filtered workflows.** A PR touching only `apps/frontend/` will only trigger the frontend lint/build; a PR touching backend + frontend triggers both.

## Code of Conduct

Be kind. Disagreements happen; make them about code, not people.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
