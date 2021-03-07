---
title: "LibrePhotos Developer Install"
excerpt: "How to install LibrePhotos for Developers"
last_modified_at: 2021-3-06
category: 1 
---
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)

**Currently the project is in very early stages, some bugs may exist. If you find any please log an issue** 

# For developers:

Pull frontend code with `git clone https://github.com/LibrePhotos/librephotos-frontend.git ${codedir}/frontend/`

Pull backend code into `git clone https://github.com/LibrePhotos/librephotos.git ${codedir}/backend/`

Pull librephotos-docker repo `git clone https://github.com/LibrePhotos/librephotos-docker.git`

Set the needed variables in .evn (take librephotos.env as model)

Also set the codedir variable that tells docker where your source folder are

Run `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`

This will build images from scratch (can take a long time the first time)
Now you can develop and benefit from code auto reload from both backend and frontend
N.B. If you already built this image once, when you do force rebuild you have to run 

`docker-compose -f docker-compose.yml -f docker-compose.dev.yml  build --no-cache frontend`

`docker-compose -f docker-compose.yml -f docker-compose.dev.yml  build --no-cache backend`

based on which one you changed if these changes need rebuild as for added dependencies/libraries etc.

and then the usual `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`

If you use vscode you can also benefit auto completion and other goodies. For this just type `code .` in your dockerfile folder.
Vscode will open and ask you if you want to reopen it in the container. If you do it he will add his server to the docker layers (first time you do it can take a couple of minutes) and you will have the same python interpreter librephotos is using internally hence the same installed libraries in auto completion and the same development environment will be shared by all devs (isort, flake8 and pylint for example)