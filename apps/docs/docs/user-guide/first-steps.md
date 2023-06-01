---
title: "✔️ First steps"
excerpt: "First steps after setting up"
sidebar_position: 1
---

## First steps after setting up

On your first visit, you should see the first time setup. Fill out the details and login. The next step is to set up your scan directory. Click on the green button, which is on the photo site, and fill out your scan directory. After saving, your first scan should start.

The basic idea is this:

- For scanning photos that reside in the local file system
  - Only the admin user can change the "scan directory" of the users, including that of the admin themselves.
  - Normal users cannot change their own "scan directory"
  - Only the admin can find the page to control this - under the user icon (top right) > `Admin Area`
- For scanning photos that reside in external Nextcloud instances
  - Any user can change their own Nextcloud endpoint, and choose a top level directory in the Nextcloud account.

## How to change your scan directory

Click on your avatar in the top right, and go to `Admin Area`. On this page, it will show a list of users. Manually set the `Scan Directory` for the desired user. Only an admin can do this.

## How to start a scan

Click on your avatar in the top right, and go to `Library`. Click the green `Scan photos (file system)` button.

## How to import photos from an external Nextcloud instance

If you have a Nextcloud instance, you can also input login details for it in the `Dashboard` > `Library` page.
Fill out the details for the Nextcloud section. Once logged in (the little circle next to `Nextcloud Scan Directory` will be green), you can choose a top level directory in your logged in Nextcloud account. Once this has been configured, you can click the blue `Scan photos (Nextcloud)` button. This will copy the contents of the specified Nextcloud directory ([excluding videos](https://github.com/LibrePhotos/librephotos/issues/278)) to the local filesystem.
