---
title: "🐋 Standard Docker Setup"
description: "Traditional multi-container deployment with nginx proxy."
sidebar_position: 2
---

## Docker Compose

We recommend you use docker compose as this matches the demo and development environment the most.

### Compatibility

You need an x86 or ARM64 processor, and it is recommended to have 4GBs of RAM. Due to limited memory & processing power, ARM64 will not be as fast.

### Size

You will need at least 10 GB of HDD Space for the docker images, thumbnails, database and machine learning models.

### 🚀 Installation

Clone the repo: `git clone https://github.com/LibrePhotos/librephotos.git`

Navigate to the deploy/compose folder: `cd librephotos/deploy/compose`

Copy the template variable file (containing options such as the location of your photos): `cp librephotos.env .env`

:::info

It is important that you rename it to .env. Otherwise docker compose cannot find your variables.

:::

Open `.env` in your favorite text editor and make the required changes. E.g., using nano: `nano .env`

Do not forget to create the directories you specified in the `.env` file if they do not exist.

:::warning PostgreSQL v18+ Volume Mount Change
If you are using Postgres v18+, you must mount your database volume to `/var/lib/postgresql` instead of `/var/lib/postgresql/data`. See the [advanced usage guide](environment-variables.md#postgresql-v18-volume-mount-change) for details.
:::

Start LibrePhotos with `docker compose up -d`

You should have LibrePhotos accessible after a few minutes of boot-up on [localhost:3000](http://localhost:3000)

## Next Steps

Once LibrePhotos is running, you'll be guided through a **First Time Setup Wizard** that will help you:

1. Create your admin account
2. Configure site settings (uploads, user registration)
3. Set up your photo scan directory

For more details, see the [first steps guide](../user-guide/first-steps.md).

### Updating

To update LibrePhotos when using Docker Compose, first refresh your checkout so you also pick up changes to `docker-compose.yml`, then update the running containers. From the `librephotos/deploy/compose` folder that was created when you installed LibrePhotos, run:

```sh
git pull            # updates docker-compose.yml and the other tracked files
docker compose down
docker compose pull # only refreshes the container images
docker compose up -d
```

:::note

`docker compose pull` only downloads newer container images. `docker-compose.yml` is a tracked file in the repository and gains new settings over time. Recent versions, for example, added the lines that pass `workerConcurrency`, `gunicornTimeout` and `frontendBaseUrl` from your `.env` through to the backend, and changed the database volume path for Postgres v18+. If your `docker-compose.yml` predates those changes, setting the matching variables in `.env` has no effect until you `git pull`.

Your `.env` is not tracked by git, so `git pull` will not touch your settings. After updating, compare it against the shipped `librephotos.env` to pick up any newly documented variables.

If you edited `docker-compose.yml` yourself — for instance to use the GPU image or to set resource limits, as described in the [advanced usage guide](environment-variables.md) — `git pull` may refuse to update or report a conflict. Run `git stash` before the pull and `git stash pop` afterwards, then re-apply your changes on top of the updated file.

:::
