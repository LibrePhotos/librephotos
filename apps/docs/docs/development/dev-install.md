---
title: "👷‍♂️ Installation"
excerpt: "How to install LibrePhotos for Developers"
last_modified_at: 2024-04-10
category: 1
---

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)

## For Developers

:::info

- Do not use a relative path, because the sudo command usually starts in the root folder and does not represent the actual folder you are in.
- When using docker compose v2, replace command ```docker-compose``` with ```docker compose``` in the following instructions.

:::

Create a directory for the project: this is where all the Git repositories will be cloned into. In this guide, we will
use `"~/home/dev/librephotos` as an example.

Pull frontend code with `git clone https://github.com/LibrePhotos/librephotos-frontend.git `

Pull backend code into `git clone https://github.com/LibrePhotos/librephotos.git `

Pull librephotos-docker repo `git clone https://github.com/LibrePhotos/librephotos-docker.git`

### Setting up in Linux

```bash
codedir=~/home/dev/librephotos
cd $codedir
git clone https://github.com/LibrePhotos/librephotos-frontend.git
git clone https://github.com/LibrePhotos/librephotos.git
git clone https://github.com/LibrePhotos/librephotos-docker.git
```

### Setting up on Windows

In PowerShell:

```powershell
$Env:codedir = "~/home/dev/librephotos"
CD $Env:codedir
git clone https://github.com/LibrePhotos/librephotos-frontend.git
git clone https://github.com/LibrePhotos/librephotos.git
git clone https://github.com/LibrePhotos/librephotos-docker.git
```

### Configuring the environment
Go to the ```librephotos-docker``` directory you just cloned. Create a new file .env (take librephotos.env as a reference) and set the needed variables in it. Make sure you set the `codedir` variable that tells
docker, where your source folders are. This should be the same path as used to clone your repos.

Run `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`

This will build images from scratch (can take a long time the first time). Now you can develop and benefit from code auto reload from both backend and frontend.

If you already built this image once, when you do force rebuild you have to run the build command based on which area you changed with added dependencies/libraries etc.

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml  build --no-cache frontend
# OR
docker-compose -f docker-compose.yml -f docker-compose.dev.yml  build --no-cache backend
```

Once you have rebuilt, you can run the docker compose up command again to update the running instances.

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Next Steps

Next, take a look at the [first steps after setup](../user-guide/first-steps.md).
