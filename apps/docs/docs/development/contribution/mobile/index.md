---
title: "📱 Mobile"
description: "Development Information regarding the LibrePhotos Mobile App."
sidebar_position: 3
last_modified_at: 2026-07-23
---

Open-Source Android and iOS Mobile Application for the [LibrePhotos](https://github.com/LibrePhotos/librephotos) Project

## 🚀 Get Started

**Compatibility**

- Android 5.0+
- iOS 10.0+ (Stability on iOS is not tested yet.)

### 📱 Android

1. Download the Latest Build from [releases](https://github.com/LibrePhotos/librephotos/releases?q=mobile%2F).
2. Install the APK

### 🍎 iOS

Currently, there are no automated builds for IOS. You will need to build the app from source. Follow the instructions in the next section.

### 🔨 Build from Source

You need the dependencies required by React Native — follow the [Environment Setup](https://reactnative.dev/docs/environment-setup) guide for your platform.

You also need [Node.js](https://nodejs.org/). The app is pinned to Node 20 in `apps/mobile/.node-version`, which is what CI installs from; anything older than Node 18 will fail at `yarn install`. Tools like fnm, nodenv and asdf read `.node-version` automatically.

Once the dependencies are set up, build the app from the `apps/mobile` directory:

1. Install Yarn if you don't already have it: `npm install -g yarn`
2. `cd apps/mobile`
3. `yarn install`
4. On iOS only (macOS): install the CocoaPods dependencies with `cd ios && pod install && cd ..` (CocoaPods is part of the React Native environment setup linked above).
5. `yarn android` — or `yarn ios` on macOS.

## ✨ Code Standards

We use ESLint and Prettier to keep the code tidy. `yarn lint` (which runs `eslint --fix .`) must pass — it runs on every pull request that touches `apps/mobile/`, and again when your change lands on `dev`. `yarn test` runs the [Jest](https://jestjs.io/) tests locally — a render smoke test plus a couple of regression tests — but the suite is not part of CI yet.

## 🐛 Debugging

For debugging, we use [reactotron](https://github.com/infinitered/reactotron/)

### Enable File Logging

Logging to the phone's local file system can be enabled or disabled from the Settings page, under Debug Options → Debug Logging. It is enabled by default on a clean install.
Logs are stored in the cache directory of the phone.
For Android: `/storage/emulated/0/Android/data/com.librephotosmobile/cache/logs/`

You can also quickly send a bug report to the developer by shaking your phone. Shake-to-report only works while Debug Logging is enabled — the shake listener is registered alongside the file logger, so turning logging off disables it too.
