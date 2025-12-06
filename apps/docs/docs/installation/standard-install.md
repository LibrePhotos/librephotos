---
title: "🐋 Standard Docker Setup"
excerpt: "Traditional multi-container deployment with nginx proxy."
sidebar_position: 3
---

## Docker Compose

We recommend you use docker compose as this matches the demo and development environment the most.

### Compatibility

You need an x86 or ARM64 processor, and it is recommended to have 4GBs of RAM. Due to limited memory & processing power, ARM64 will not be as fast.

### Size

You will need at least 10 GB of HDD Space for the docker images, thumbnails, database and machine learning models.

### 🚀 Installation

Clone the repo: `git clone https://github.com/LibrePhotos/librephotos-docker.git`

Navigate to the librephotos-docker folder: `cd librephotos-docker`

Copy the template variable file (containing options such as the location of your photos): `cp librephotos.env .env`

:::info

It is important that you rename it to .env. Otherwise docker compose cannot find your variables.

:::

Open `.env` in your favorite text editor and make the required changes. E.g., using nano: `nano .env`

Do not forget to create the directories you specified in the `.env` file if they do not exist.

Start LibrePhotos with `docker-compose up -d`

You should have LibrePhotos accessible after a few minutes of boot-up on [localhost:3000](http://localhost:3000)

## Next Steps

Once LibrePhotos is running, you'll be guided through a **First Time Setup Wizard** that will help you:

1. Create your admin account
2. Configure site settings (uploads, user registration)
3. Set up your photo scan directory

For more details, see the [first steps guide](../user-guide/first-steps.md).

### Updating

To update LibrePhotos when using Docker Compose, navigate to the librephotos-docker folder that was created when you installed LibrePhotos.

Then run:

```sh
docker-compose down
docker-compose pull
docker-compose up -d
```
