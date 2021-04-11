---
title: "LibrePhotos Install"
excerpt: "How to install Libre Photos."
last_modified_at: 2021-03-07
category: 1
---

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)

**Currently the project is in very early stages, some bugs may exist. If you find any please log an issue**

### Compatibility
You need a x86 processor and it is recommended to have 8GBs of RAM.

**It kind of works on ARM processors. Due to limited ram & processing power it will not be as fast.**

**ARM Development is still in progress expect bugs.**

**ARM install instructions can be found here**

### Size
You will need at least 10 GB of HDD Space for the docker images. It needs that space because of the machine learning models.
Librephotos will also create a database and thumbnails which will need additional space.

### Docker

LibrePhotos comes with separate backend and frontend
servers. The backend serves the restful API, and the frontend serves, well,
the frontend. They are connected via a proxy.
The easiest way to do it is using Docker.

## Docker-compose method (Recommended)

Clone the repo: `git clone git@github.com:LibrePhotos/librephotos-docker.git`

`cp librephotos.env .env`

Open `.env` in your favorite text editor and make the required changes. 

Do not forget to create the directories you specified in the `.env` file if they do not exist.

Run `docker-compose up -d`


You should have librephotos accessible after a few minutes of bootup on: [localhost:3000](http://localhost:3000) unless you changed it in the .env file.
User is admin, password is admin unless you changed it in the .env file. It is recommended you change the admin username and password if Libre Photos is going to be publicly accessible via the ``.env`` file.

## First steps after setting up

You need to log in as the admin user, and set up the directory for the users. To do this, click the top right button, and go to "Admin Area". On this page, it will show a list of users, and manually set the "Scan Directory" for the desired user. Only an admin can do this. And then you can go to Dashboard - Library and click the Green "Scan photos (file system)" button. If you have a Nextcloud instance, you can also input this in the Dashboard-Library page. Once logged in (the little circle next to "Nextcloud Scan Directory will be green), you can choose a top level directory in your logged in Nextcloud account. Once this works, you can click the blue "Scan photos (Nextcloud)". The backend system will copy the contents of the Nextcloud directory you specified. 

The basic idea is this:

- For scanning photos that reside in the local file system
  - Only the admin user can change the "scan directory" of the users, including the admin itself.
  - Normal users cannot change his/her own "scan directory"
  - Only the admin can find the page to control this under the "user icon (top right) - admin area"
- For scanning photos that reside in external Nextcloud instances
  - Any user can change his/her own Nextcloud endpoint, and choose a top level directory in the Nextcloud account.

### Contributions
- Librephotos is in development. Contributions are welcome!
- Join our discord server or open a pull request to start contributing