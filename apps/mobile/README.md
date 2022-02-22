<!-- ![GitHub contributors](https://img.shields.io/github/contributors/akshay9/librephotos-mobile) -->


# 📷 LibrePhotos Mobile

Open-Source Android and iOS Mobile Application for the [LibrePhotos](https://github.com/LibrePhotos/librephotos) Project

## 🤷‍♂️  What is it?

- A self-hosted open source photo management service, with cool AI-powered features.
- Mobile App is made with React Native with support for Android and iOS.


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
3. `yarn <platform>`  # Replace platform with `android` or `ios`

For debugging we use [reactotron](https://github.com/infinitered/reactotron/)

## 🌟 Features

#### Currently implemented (From Librephotos Website):
  
  - Cross-Platform Code for Android and iOS
  - Search (With Semantic Search)
  - View photos grouped by Date
  - View Albums (People, Things, My Albums)
  - Configurable LibrePhotos Server URL with Authentication
  - Dark Mode & Themes
  
#### Upcoming:
  - Short term:
    - Stability
    - View Albums (Places, Auto Created) 
    - Create custom albums
    - Support for Video
    - See photos on the map
    - Admin Features

  - Longer term, i.e. haven't thought much about them
    - Basic photo editing, like rotation
    - Integrate Phone's Gallery
    - Share photos/albums


## 🪲 Debugging

### Enable File Logging
Logging to phone's local file system can be enabled/disabled from the Settings page. 
Logs are stored in the cache directory of the phone. 
For Android: `/storage/emulated/0/Android/data/com.librephotosmobile/cache/logs/`

You can also quickly send a bug report to the developer by shaking your phone.

**Note**: Since the app is in early development, logging is enabled by default on clean install.

## ☎️ Communication
You can join Librephoto's [Discord](https://discord.gg/xwRvtSDGWb).

### 🤝 Contributions
- Join our [discord]((https://discord.gg/xwRvtSDGWb)) server, or open a pull request to start contributing.


**Disclaimer: Currently the project is in very early stages, some bugs may exist. If you find any please log an issue**
