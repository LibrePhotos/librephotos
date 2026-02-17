[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=plastic)](https://github.com/LibrePhotos/librephotos-frontend/blob/dev/LICENSE)
<a href="https://hosted.weblate.org/engage/librephotos/">
<img src="https://hosted.weblate.org/widgets/librephotos/-/librephotos-frontend/svg-badge.svg" alt="Translation status" />
</a>

# LibrePhotos Frontend

The web frontend for [LibrePhotos](https://github.com/LibrePhotos/librephotos) — a self-hosted, open-source photo management service.

Built with **React 18**, **TypeScript**, and **Vite**.

## Tech Stack

| Category             | Technology                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| UI Framework         | [React 18](https://react.dev/) with [TypeScript](https://www.typescriptlang.org/)              |
| Build Tool           | [Vite](https://vite.dev/)                                                                      |
| Component Library    | [Mantine 8](https://mantine.dev/)                                                              |
| Routing              | [TanStack Router](https://tanstack.com/router)                                                 |
| Data Fetching        | [TanStack Query](https://tanstack.com/query)                                                   |
| Maps                 | [MapLibre GL](https://maplibre.org/) via [react-map-gl](https://visgl.github.io/react-map-gl/) |
| Charts               | [Recharts](https://recharts.org/)                                                              |
| Internationalization | [i18next](https://www.i18next.com/)                                                            |
| Form Validation      | [Zod](https://zod.dev/)                                                                        |
| Testing              | [Vitest](https://vitest.dev/)                                                                  |

## Development

### Using Docker (recommended)

The easiest way to develop is via Docker Compose, which sets up the full stack (backend, frontend, database, proxy) with hot-reload enabled. See the [development install guide](https://docs.librephotos.com/docs/development/dev-install) and the backend [CONTRIBUTING.md](https://github.com/LibrePhotos/librephotos/blob/dev/CONTRIBUTING.md) for step-by-step instructions.

### Standalone (frontend only)

If you want to work on the frontend independently:

```bash
# Install dependencies
yarn install

# Start the development server
yarn start

# Run tests
yarn test

# Run tests with coverage
yarn test:coverage

# Production build
yarn build
```

> **Note:** The frontend expects a running LibrePhotos backend. See the [backend repo](https://github.com/LibrePhotos/librephotos) for setup instructions.

### Linting & Formatting

The project uses **ESLint** and **Prettier** with pre-commit hooks via Husky and lint-staged.

```bash
# Check for linting errors
yarn lint:error

# Auto-fix linting issues
yarn lint:warning:fix
```

Code style conventions:

- Line length: 120 characters
- Prettier for formatting (configured in `prettier.config.cjs`)
- Functional components with hooks
- TypeScript types preferred over interfaces

## Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](https://github.com/LibrePhotos/librephotos/blob/dev/CONTRIBUTING.md) in the backend repository for:

- Development environment setup
- Docker architecture overview
- Code quality standards
- Pull request guidelines

For translations, help out on [Weblate](https://hosted.weblate.org/engage/librephotos/).

## Related Projects

| Repository                                                              | Description                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| [librephotos](https://github.com/LibrePhotos/librephotos)               | Django backend (API, ML models, background jobs) |
| [librephotos-docker](https://github.com/LibrePhotos/librephotos-docker) | Docker Compose deployment configurations         |
| [librephotos.docs](https://github.com/LibrePhotos/librephotos.docs)     | Documentation website source                     |

## License

This project is licensed under the [MIT License](LICENSE).
