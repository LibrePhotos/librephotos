---
title: "Roadmap page"
description: "How the public roadmap at /roadmap is built from src/data/roadmap.ts and the release index, and what to change in it when a release ships or work starts."
sidebar_position: 9
---

The [roadmap](/roadmap) shows what LibrePhotos has shipped and what comes next, limited to features and ways to install it. Everything on it comes from one list, `ROADMAP` in `apps/docs/src/data/roadmap.ts`; the page (`src/pages/roadmap.tsx`) only sorts and shows it.

## The three kinds of entries

| Entry | Fields | Where it shows |
| --- | --- | --- |
| Released with a version | `version: "1.7.0"` | Under **Shipped**, grouped by release, once that release's post is in `src/data/releases.json`. Until then under **Done, in the next release**, with the same "Not released yet" marker as `<Since>`. |
| A weekly release before 1.0.0 | `weekly: "2025w35"`, `date: "2025-08-28"` | Under **Shipped**, linked to `/blog/<weekly>`. |
| Not merged yet | `status: "in-progress" \| "beta" \| "planned"`, and `issue` or `pr` | Under **In progress and planned**, linked to the issue or pull request. |

Every entry also has an `id`, a `track` (`feature`, or `install` for a new way to get or run LibrePhotos), a `title`, a one-line `body` and a `link`. Link shipped entries to the section of the user guide or installation docs that explains them, planned ones to their public issue. The page shows no dates for planned work, only its status.

## When work is merged

Replace the entry's `status`, `issue` and `pr` with the `version` of the next release, and point `link` at the docs you wrote for it. Nothing else changes when the release ships: merging its post regenerates `releases.json`, and the entry moves to **Shipped** with that release's date.

## When work starts or is planned

Add an entry with `status: "planned"` (or `in-progress` once a pull request is open) and its `issue` or `pr`. Keep the page to what is public on GitHub: features and ways to install. Plans that are not in a public issue stay off it.

## Checks

`node --test "scripts/**/*.test.mjs"` (CI: `docs.yml`) runs `scripts/roadmap.test.mjs`: ids are unique, every `version` is either released or newer than the latest release, planned entries name their issue or pull request, and links point to the docs, the blog or the LibrePhotos repository. `yarn build` fails on a link to a page that does not exist, but not on a wrong `#anchor`, so open the links you changed.
