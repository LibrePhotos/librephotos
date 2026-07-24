---
title: "🖱️ To-Do"
description: "On going migrations regarding the mobile app."
sidebar_position: 3
last_modified_at: 2021-05-31
---

You can look into the issues [here](https://github.com/LibrePhotos/librephotos/issues?q=is%3Aopen+is%3Aissue+label%3Amobile),
on what features are missing from the mobile app.

**Show local images everywhere**

The local images to not yet show up in all views. You can help out by adding them to the views by implementing new selectors.

**Maintainability**

We currently are working on improving maintainability, by converting our code base to TypeScript. Most of the app is already TypeScript, but a few dozen plain-JavaScript modules remain — mostly under `src/Theme`, `src/Containers`, `src/Components` and `src/Navigators`. These are function components, theme and config files rather than classes. You can help out by converting them to TypeScript!

**Viewing images offline**

The Redux migration is done. The mobile app now uses Zustand stores (`apps/mobile/src/stores/`) with a typed API client built on TanStack Query (`apps/mobile/src/api_client/`), and the frontend uses TanStack Query too (`apps/frontend/src/api_client/`). AsyncStorage persistence for the stores is also in place: each store wraps Zustand's `persist` middleware with `createJSONStorage(() => AsyncStorage)`, and JWTs are persisted through `apps/mobile/src/api_client/platform/tokenStorage.ts`.

A few things still stand between us and viewing images offline:

- [ ] Create a shared package for the state management and API calls of the frontend and the mobile app (single sourcing)
- [ ] Persist the TanStack Query cache to AsyncStorage so fetched data survives an app restart
- [ ] Cache remote thumbnails and media on disk

**Documentation**

Write docs for functions and components and explain what they do, why it's there.
