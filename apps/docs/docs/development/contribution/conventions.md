---
title: "Conventions"
description: "Two rules every pull request follows: no comments in new code, and every change reflected in the docs. How the conventions check enforces them and how to run it."
sidebar_position: 5
---

Two rules hold for every pull request, in every app. The `conventions` workflow (`.github/workflows/conventions.yml`) checks both on every pull request, whatever paths it touches, with `scripts/check-conventions.mjs`.

## No comments in new code

New or changed code carries no comments, docstrings included. Names, types and tests say what the code does; the reason behind it goes into the commit message, the pull request or these docs, where it does not go stale next to code that moved on.

The check looks only at the lines a pull request adds. Comments elsewhere stay until someone changes their line: a line you touch loses its comment, so the repository gets cleaner without a big cleanup.

What counts as a comment, per language:

| Files | Comments |
| --- | --- |
| `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | `//`, `/* */`, JSDoc and JSX `{/* */}`, found with the TypeScript parser, so strings, template literals, regular expressions and JSX text are never mistaken for one |
| `.json`, `.jsonc` | `//` and `/* */`, and a `"//..."` key |
| `.py`, `.pyi` | `#` comments (Python's own `tokenize`, so `#` in strings and f-strings is not one), docstrings and any other statement that is only a string (`ast`) |
| `.rs` | `//`, `///`, `//!` and nested `/* */`, outside strings, raw strings and char literals; lifetimes and labels are not quotes |
| `.css`, `.scss`, `.sass`, `.less` | `/* */`, plus `//` in SCSS, Sass and Less (not inside strings or an unquoted `url(...)`) |
| `.glsl`, `.vert`, `.frag`, `.wgsl` | `//` and `/* */` |
| `.sh`, `.bash` | `#` where it starts a word, outside quotes, `${...}` and here-document bodies |
| `.yml`, `.yaml` | `#` outside quoted scalars and block scalars; in a workflow (`.github/workflows/`, `action.yml`) the shell comments in a `run:` block too |
| `.toml` | `#` outside strings |
| `Dockerfile`, `Dockerfile.*` | lines starting with `#` |

Tool suppressions (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `# noqa`, `# fmt: skip`) are comments too, and the root `AGENTS.md` already rules them out. Markdown, MDX, SQL, HTML, `.env` and `requirements*.txt` files are not checked.

These pass, because they are not explanations:

- a shebang (`#!/usr/bin/env node`) on the first line;
- a TypeScript `/// <reference ... />` directive and `// @ts-check`;
- a Python encoding declaration (`# -*- coding: utf-8 -*-`) on the first two lines;
- the `# raw-create: <reason>` marker on a test's raw `Model.objects.create`, which `api/tests/infra/test_test_data_factories.py` reads;
- parser directives (`# syntax=`, `# escape=`, `# check=`) at the top of a Dockerfile;
- generated and vendored files: lockfiles, anything under a `migrations/` folder (Django and Drizzle, with their JSON), `*.gen.*` files such as `routeTree.gen.ts`, `apps/backend/openapi.json`, `apps/backend/vulture_whitelist.py` (printed by `check_dead_code.py --make-whitelist`), Tauri's `src-tauri/gen/`, `node_modules`, the vendored `apps/backend/chunked_upload/`, snapshots and minified files.

The allow-list lives in `scripts/conventions/comments.mjs` (`GENERATED_PATHS`, `ALLOWED_COMMENTS`) and every entry has a test in `scripts/check-conventions.test.mjs`.

## Every change is reflected in the docs

A pull request that changes what an app or package does also changes `apps/docs/docs/` or `apps/docs/blog/`. The sources are:

- `apps/backend/`, `apps/frontend/src/`, `apps/mobile/src/` and `apps/desktop/`;
- `packages/*/src/`;
- `deploy/`.

Write it where its readers look: what users see in the [user guide](../../user-guide/index.md), deploy, settings and environment variables under [installation](../../installation/index.md), and internal changes (architecture, conventions, how a part works) under [development](../index.md). Mark what is not released yet with `<Since version="<next release>" />`, as the root `AGENTS.md` describes.

A pull request needs no docs change when everything it changes in those folders is one of:

- tests: `tests/`, `test/`, `__tests__/`, `__mocks__/`, `e2e/` and `fixtures/` folders, `*.test.*` and `*.spec.*` files, `test_*.py`, `*_test.py`, `conftest.py` and snapshots;
- CI: anything under `.github/`;
- lockfiles;
- translations other than English (`apps/frontend/src/locales/<lang>/`, which Weblate writes);
- Markdown files, such as an app's `AGENTS.md` or `README.md`;
- a version-only dependency bump, as Renovate opens them: a `package.json` whose only change is the versions in its dependency sections, `engines` or `packageManager`; `requirements*.txt` lines that change only their versions; quoted versions in `pyproject.toml` and `Cargo.toml`; `.nvmrc` and `.python-version`; and `FROM`, `ARG *VERSION*=` and `image:` lines (tags and digests) in Dockerfiles, compose files and manifests.

Files outside those folders, such as `scripts/`, `tools/`, `plans/` or the root manifests, do not need docs either.

## Running the check

From the repository root, with Node 24, `typescript` installed in a `node_modules` (the root workspace is enough: `npm ci --workspace packages/api-client --ignore-scripts`) and Python 3.12 or newer on `PATH` (or named in `PYTHON`):

```bash
node scripts/check-conventions.mjs
node --test scripts/check-conventions.test.mjs
```

It compares the working tree, untracked files included, with the merge base of `origin/dev`. `--base <rev>` picks another base (CI passes the pull request's base commit), `--head <rev>` checks a commit instead of the working tree, `--only comments` or `--only docs` runs one rule, and `--json` prints the findings as JSON. Each comment is reported as `path:line` with its text; the docs rule lists the source files that changed without a docs change.
