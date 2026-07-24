---
title: "🖱️ To-Do"
description: "Ways to contribute to the LibrePhotos frontend: open issues, E2E tests, and docs."
sidebar_position: 2
last_modified_at: 2021-05-31
---

You can look into the issues [here](https://github.com/LibrePhotos/librephotos/issues?q=is%3Aopen+is%3Aissue+label%3Afrontend),
on what features are missing from the frontend.

E2E tests already exist in `apps/frontend/e2e`. They use [Cypress](https://www.cypress.io/) with the
[cucumber preprocessor](https://github.com/badeball/cypress-cucumber-preprocessor): the specs are
Gherkin `.feature` files under `test/features`, backed by page objects in `test/pages` and step
definitions in `test/step_definitions`. They currently cover login, duplicates, stacks and user
settings — more coverage is very welcome.

To run them, first bring up the dedicated stack from `deploy/compose` (it serves the app on
http://localhost:8080 and seeds an `admin`/`admin` account, which is what `cypress.config.js`
expects):

```bash
cd deploy/compose
docker compose --env-file librephotos.env -f docker-compose.e2e.yml up -d
```

Then, in a second shell, install and run the suite:

```bash
cd apps/frontend/e2e
yarn install
yarn test    # or `yarn start` for the interactive runner
```

The E2E suite is not wired into CI, so please run it locally before opening a PR.

You can also help by expanding the documentation.
