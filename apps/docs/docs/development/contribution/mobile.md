---
title: "📱 Mobile"
excerpt: "What data does Libre Photos collect."
last_modified_at: 2022-03-09
category: 5
---

Open-Source Android and iOS Mobile Application for the [LibrePhotos](https://github.com/LibrePhotos/librephotos) Project

## 🚀 Get Started

**Compatibility**

- Android 5.0+
- iOS 9.0+ (Stability on iOS is not tested yet.)

### 📱 Android

1. Download the Latest Build from [Releases](https://github.com/LibrePhotos/librephotos-mobile/releases).
2. Install the APK

### 🍎 iOS

Currently there are no automated build for IOS. You will need to builds the app from source. Follow the instructions in the next section.

### 🔨 Build from Source

You also need to install the dependencies required by React Native: [Environment Setup](https://reactnative.dev/docs/environment-setup)

Once the dependencies are setup, you can run the project as follows:

1. `npm install -g yarn`
2. `yarn install`
3. `yarn <platform>` # Replace platform with `android` or `ios`

## 🐛 Debugging

For debugging we use [reactotron](https://github.com/infinitered/reactotron/)

### Enable File Logging

Logging to phone's local file system can be enabled/disabled from the Settings page.
Logs are stored in the cache directory of the phone.
For Android: `/storage/emulated/0/Android/data/com.librephotosmobile/cache/logs/`

You can also quickly send a bug report to the developer by shaking your phone.
