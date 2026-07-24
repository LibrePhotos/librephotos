---
title: "Contribution"
description: "How to contribute to LibrePhotos across the backend, frontend, mobile, and Docker."
sidebar_position: 2
---

# Contributing to LibrePhotos

Thank you for considering contributing to LibrePhotos! We welcome contributions from everyone. Here are some guidelines to help you get started.

## How to Contribute

1. **Fork the Repository**: LibrePhotos is a single monorepo, so there is just one repository to fork: [github.com/LibrePhotos/librephotos](https://github.com/LibrePhotos/librephotos). Everything lives there — `apps/backend/`, `apps/frontend/`, `apps/mobile/`, `apps/docs/`, and `deploy/`. Do not open pull requests against the archived `librephotos-frontend`, `librephotos-docker`, `librephotos.docs`, or `librephotos-mobile` repositories. Depending on what you're working on, see the [Frontend](https://docs.librephotos.com/docs/development/contribution/frontend/), [Backend](https://docs.librephotos.com/docs/development/contribution/backend/), [Docker](https://docs.librephotos.com/docs/development/contribution/docker), and [Mobile](https://docs.librephotos.com/docs/development/contribution/mobile/) guides.

2. **Clone the Repository**: Clone your forked repository to your local machine. A GitHub fork keeps the name `librephotos` by default.
    ```sh
    git clone https://github.com/your-username/librephotos.git
    ```

3. **Create a Branch**: Create a new branch for your feature or bug fix.
    ```sh
    git checkout -b my-feature-branch
    ```

4. **Make Changes**: Make your changes to the codebase. Ensure your code follows the project's coding standards.

5. **Commit Changes**: Commit your changes with a descriptive commit message.
    ```sh
    git commit -m "Description of my changes"
    ```

6. **Push Changes**: Push your changes to your forked repository.
    ```sh
    git push origin my-feature-branch
    ```

7. **Create a Pull Request**: Open a pull request against the upstream repository, targeting the `dev` branch (the default branch — not `main`). Provide a clear description of your changes and why they are necessary. See the repository's [CONTRIBUTING.md](https://github.com/LibrePhotos/librephotos/blob/dev/CONTRIBUTING.md) for the full pull-request guidelines.

<!-- ## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](https://github.com/LibrePhotos/librephotos/blob/main/CODE_OF_CONDUCT.md). By participating in this project, you agree to abide by its terms. -->

## Reporting Issues

LibrePhotos is a monorepo with a single [issue tracker](https://github.com/LibrePhotos/librephotos/issues) — bugs, feature requests, and documentation problems all go there, not to the archived `librephotos-frontend`, `librephotos-docker`, `librephotos.docs`, or `librephotos-mobile` repositories. Pick the **Bug report**, **Enhancement request**, or **Incorrect/outdated information** template, and label the issue with the affected area (for example `frontend` or `mobile`).

## Getting Help

If you need help, feel free to ask questions on our [Discord server](https://discord.com/invite/xwRvtSDGWb). You can also watch development videos on [Niaz Faridani-Rad's channel](https://www.youtube.com/channel/UCZJ2pk2BPKxwbuCV9LWDR0w).

## Documentation

The documentation site is built with [Docusaurus](https://docusaurus.io/) and lives in [`apps/docs/`](https://github.com/LibrePhotos/librephotos/tree/dev/apps/docs) in the main repository. Improving it is as simple as opening a pull request against that folder — the pages under `apps/docs/docs/` are plain Markdown. To preview your changes locally, run `cd apps/docs && yarn install && yarn start`.

## Translations

Translations are contributed through [Weblate](https://hosted.weblate.org/engage/librephotos/), not by editing `apps/frontend/src/locales/<lang>/translation.json` directly — direct edits to the non-English files are overwritten by Weblate. Change only the English strings in code, and translators will pick them up from there.

We appreciate your contributions and look forward to working with you!
