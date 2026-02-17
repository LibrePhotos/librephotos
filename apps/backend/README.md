[![Discord](https://img.shields.io/discord/784619049208250388?style=plastic)][discord] [![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com)](https://librephotos.com/)
[![Read the docs](https://img.shields.io/static/v1?label=Read&message=the%20docs&color=blue&style=plastic)](https://docs.librephotos.com/) [![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)](https://github.com/LibrePhotos/librephotos/graphs/contributors) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=plastic)](https://github.com/LibrePhotos/librephotos/blob/dev/LICENSE)
<a href="https://hosted.weblate.org/engage/librephotos/">
<img src="https://hosted.weblate.org/widgets/librephotos/-/librephotos-frontend/svg-badge.svg" alt="Translation status" />
</a>

# LibrePhotos

![](https://github.com/LibrePhotos/librephotos/blob/dev/screenshots/mockups_main_fhd.png?raw=true)
<sub>Mockup designed by rawpixel.com / Freepik</sub>

A self-hosted, open-source photo management service with automatic face recognition, object detection, and semantic search — powered by modern machine learning.

- **Stable** demo is available here: https://demo1.librephotos.com/ . User is ```demo```, password is ```demo1234``` (with sample images).
- Latest **development** demo is available here: https://demo2.librephotos.com/ (same user/password)
- You can watch development videos on [Niaz Faridani-Rad's channel](https://www.youtube.com/channel/UCZJ2pk2BPKxwbuCV9LWDR0w)
- You can join our [Discord][discord].

## Installation

Step-by-step installation instructions are available in our [documentation](https://docs.librephotos.com/docs/installation/standard-install).

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM      | 4 GB    | 8 GB+       |
| Storage  | 10 GB (plus your photo library) | SSD recommended |
| CPU      | 2 cores | 4+ cores    |
| OS       | Any Docker-compatible OS | Linux |

> **Note:** Machine learning features (face recognition, scene classification, image captioning) are memory-intensive. 8 GB+ RAM is strongly recommended for smooth operation.

## Features

  - Support for all types of photos including raw photos
  - Support for videos
  - Timeline view
  - Scans pictures on the file system
  - Multiuser support
  - Generate albums based on events like "Thursday in Berlin"
  - Face recognition / Face classification
  - Reverse geocoding
  - Object / Scene detection
  - Semantic image search
  - Search by metadata

## Tech Stack

### Backend

- **Framework:** [Django 5](https://www.djangoproject.com/) with [Django REST Framework](https://www.django-rest-framework.org/)
- **Database:** [PostgreSQL](https://www.postgresql.org/)
- **Task Queue:** [Django-Q2](https://github.com/django-q2/django-q2)
- **Image Conversion:** [ImageMagick](https://github.com/ImageMagick/ImageMagick)
- **Video Conversion:** [FFmpeg](https://github.com/FFmpeg/FFmpeg)
- **Exif Support:** [ExifTool](https://github.com/exiftool/exiftool)

### Frontend

- **UI:** [React 18](https://react.dev/) with [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite](https://vite.dev/)
- **Component Library:** [Mantine](https://mantine.dev/)
- **Routing:** [TanStack Router](https://tanstack.com/router)
- **Data Fetching:** [TanStack Query](https://tanstack.com/query)
- **Maps:** [MapLibre GL](https://maplibre.org/)
- **Internationalization:** [i18next](https://www.i18next.com/)

### Machine Learning

- **Face detection:** [face_recognition](https://github.com/ageitgey/face_recognition)
- **Face classification/clustering:** [scikit-learn](https://scikit-learn.org/) and [hdbscan](https://github.com/scikit-learn-contrib/hdbscan)
- **Image captioning:** [im2txt](https://github.com/HughKu/Im2txt)
- **Scene classification:** [places365](http://places.csail.mit.edu/)
- **Reverse geocoding:** [geopy](https://github.com/geopy/geopy)

### Infrastructure

- **Deployment:** [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)
- **Reverse Proxy:** [Nginx](https://nginx.org/)

### API Documentation

After starting LibrePhotos, interactive API docs are available at:

- **Swagger UI:** `http://localhost:3000/api/swagger`
- **ReDoc:** `http://localhost:3000/api/redoc`

## How to help out

- ⭐ **Star** this repository if you like this project!
- 🚀 **Developing**: Get started in less than 30 minutes by following [this guide](https://docs.librephotos.com/docs/development/dev-install). Also see our [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development setup, code quality standards, and PR guidelines.
- 🗒️ **Documentation**: Improving the documentation is as simple as submitting a pull request [here](https://github.com/LibrePhotos/librephotos.docs)
- 🧪 **Testing**: If you want to help find bugs, use the ```dev``` tag and update it regularly. If you find a bug, open an issue.
- 🧑‍🤝‍🧑 **Outreach**: Talk about this project with other people and help them to get started too!
- 🌐 **Translations**: Make LibrePhotos accessible to more people with [weblate](https://hosted.weblate.org/engage/librephotos/).
- 💸 [**Donate**](https://github.com/sponsors/derneuere) to the developers of LibrePhotos

## Related Projects

| Repository | Description |
|------------|-------------|
| [librephotos-frontend](https://github.com/LibrePhotos/librephotos-frontend) | React/TypeScript web frontend |
| [librephotos-docker](https://github.com/LibrePhotos/librephotos-docker) | Docker Compose deployment configurations |
| [librephotos.docs](https://github.com/LibrePhotos/librephotos.docs) | Documentation website source |
| [librephotos-mobile](https://github.com/LibrePhotos/librephotos-mobile) | Mobile application |

## License

This project is licensed under the [MIT License](LICENSE).

[discord]: https://discord.gg/xwRvtSDGWb
