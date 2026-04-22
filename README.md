[![Discord](https://img.shields.io/badge/Discord-LibrePhotos-5865F2?style=plastic&logo=discord&logoColor=white)](https://discord.com/invite/xwRvtSDGWb) [![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com)](https://librephotos.com/) [![Read the docs](https://img.shields.io/static/v1?label=Read&message=the%20docs&color=blue&style=plastic)](https://docs.librephotos.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=plastic)](LICENSE)
<a href="https://hosted.weblate.org/engage/librephotos/">
<img src="https://hosted.weblate.org/widgets/librephotos/-/librephotos-frontend/svg-badge.svg" alt="Translation status" />
</a>

# LibrePhotos

A self-hosted, open-source photo management service with automatic face recognition, object detection, and semantic search — powered by modern machine learning.

- **Stable** demo: https://demo1.librephotos.com/ (user `demo`, password `demo1234`)
- **Development** demo: https://demo2.librephotos.com/ (same credentials)
- Discord: https://discord.com/invite/xwRvtSDGWb

## Repository layout

This is a monorepo that consolidates what was previously five separate repositories.

| Path | What it is | Previous repo |
|---|---|---|
| [`apps/backend/`](apps/backend/) | Django 5 API, machine-learning pipelines, background jobs | `librephotos` |
| [`apps/frontend/`](apps/frontend/) | React 18 + Vite web client, i18next localization | `librephotos-frontend` |
| [`apps/mobile/`](apps/mobile/) | React Native mobile client (Android) | `librephotos-mobile` |
| [`apps/docs/`](apps/docs/) | Docusaurus site published to https://docs.librephotos.com | `librephotos.docs` |
| [`deploy/`](deploy/) | Dockerfiles, Compose configs, proxy, Kubernetes manifests | `librephotos-docker` |

Commit history from all five repositories is preserved — `git log --follow apps/<app>/<file>` works across the move. Tags from the original repositories have been namespaced (e.g. `backend/v0.1`, `frontend/0.2.0-rc`, `mobile/v1.1.1`, `docker/2026w14`).

## Installation

Step-by-step installation instructions for end users live in the [documentation](https://docs.librephotos.com/docs/installation/standard-install).

### System requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM      | 4 GB    | 8 GB+       |
| Storage  | 10 GB + your photo library | SSD recommended |
| CPU      | 2 cores | 4+ cores    |
| OS       | Any Docker-compatible OS | Linux |

Machine-learning features (face recognition, scene classification, captioning) are memory-intensive. 8 GB+ RAM is strongly recommended.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and the per-app READMEs:
- [Backend](apps/backend/README.md)
- [Frontend](apps/frontend/README.md)
- [Mobile](apps/mobile/README.md)
- [Docs site](apps/docs/README.md)

The Docker Compose-based dev environment lives in [`deploy/compose/`](deploy/) and is described in the [development install guide](https://docs.librephotos.com/docs/development/dev-install).

## License

MIT — see [LICENSE](LICENSE). Per-app `LICENSE` files preserve the original authorship attributions.
