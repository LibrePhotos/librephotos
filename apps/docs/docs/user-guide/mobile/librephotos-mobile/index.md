---
title: "📱  LibrePhotos Mobile"
description: "Which apps does Librephotos have?"
sidebar_position: 1
---

## LibrePhotos Mobile

[LibrePhotos Mobile](https://github.com/LibrePhotos/librephotos/tree/dev/apps/mobile) is the official app, which is at the proof-of-concept stage. It's written in react-native and in the future will share more code with the frontend.

You can download the .apk [here](https://github.com/LibrePhotos/librephotos/releases/tag/mobile%2Flatest). It is technically possible to compile it to also work on iOS, but nobody stepped up to do that yet.

## Connecting to your server

When you first open the app, enter your LibrePhotos server in the **Server Name** field — use the same address you use to reach LibrePhotos in a browser, for example `photos.example.com` or `192.168.1.10:3000`. The protocol is optional: the app tries `http://` first and falls back to `https://`, and it lowercases the address and drops any trailing slash for you.

The app checks the server as you type. Wait for the green check mark, which means the server was reached. A red warning triangle and an "Unable to connect to the server" message means the address could not be reached — the check has a short timeout, so a slow or distant server may need a moment or a second try. Once the check is green, sign in with your LibrePhotos username and password.
