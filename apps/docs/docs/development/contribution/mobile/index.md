---
title: "📱 Mobile"
description: "Development Information regarding the LibrePhotos Mobile App."
sidebar_position: 3
last_modified_at: 2026-09-26
---

The LibrePhotos mobile app lives in [`apps/mobile/`](https://github.com/LibrePhotos/librephotos/tree/dev/apps/mobile). It is an [Expo](https://expo.dev/) (React Native, New Architecture) app for Android and iOS with an offline-first data model: a local SQLite mirror of the library, kept current by delta sync against the backend, plus camera-roll backup. The [app README](https://github.com/LibrePhotos/librephotos/tree/dev/apps/mobile#readme) is the full developer guide, and the design documents are in [`plans/mobile-v2/`](https://github.com/LibrePhotos/librephotos/tree/dev/plans/mobile-v2).

## 🔨 Setup

You need [Node.js](https://nodejs.org/) 22, which is what CI uses.

The app is an npm workspace together with the shared API client in `packages/api-client`, so install once from the repository root. The root `package-lock.json` is the only lockfile:

1. `npm ci` at the repository root
2. `cd apps/mobile`
3. `npx expo start --go` and scan the QR code with Expo Go, or build a development build with `npx expo run:android` / `npx expo run:ios`

The native `android/` and `ios/` folders are not committed. `expo prebuild` generates them from `app.json`.

## ✨ Code Standards

Every pull request that touches `apps/mobile/`, `packages/` or the root `package.json` / `package-lock.json` runs typecheck, lint and the Jest suites in CI. Run the same checks locally before pushing:

```bash
npm run check --workspace apps/mobile
```

The shared API client has its own checks:

```bash
npm run test --workspace packages/api-client
```

## 🌐 Translations

English strings live in `apps/mobile/src/i18n/locales/en.ts`. Other languages fall back to English until translations are added.
