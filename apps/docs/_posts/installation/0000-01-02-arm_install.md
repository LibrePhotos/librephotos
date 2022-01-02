---
title: "Docker Compose (ARM64)"
excerpt: "How to install Libre Photos on an ARM device (e.g. Raspberry Pi)."
last_modified_at: 2021-10-07
category: 1
---
> Currently, the project is in very early stages; some bugs may exist. If you find any, please log an issue.

> It kind of works on ARM processors. Due to limited ram & processing power it will not be as fast.
> ARM Development is still in progress expect bugs.

## Requirements

### Architecture

LibrePhotos will only work on ARM devices (e.g. Raspberry Pis) if they are running an ARM64 operating system.
Check what version you have by running `dpkg --print-architecture`. If it says `arm64`, you are good to go. Otherwise,
you need to install an ARM64 operating system on your device.

### Size

You will need at least 10 GB of storage space for the docker images. This space is mainly used by machine learning
models. LibrePhotos will also create a database and thumbnails, which will need additional space.

### Docker

LibrePhotos comes with separate backend and frontend servers. The backend serves the restful API, and the frontend
serves, well, the frontend. They are connected via a proxy. The easiest way to do it is using Docker.

## Docker-compose method (Recommended)

Clone the repo: `git clone https://github.com/LibrePhotos/librephotos-docker.git`

`cp librephotos.env .env`

**Open `.env` in your favorite text editor and make the required changes.**

Do not forget to create the directories you specified in the `.env` file if they do not exist.

Run `docker-compose up -d`

You should have librephotos accessible after a few minutes of boot-up on: [localhost:3000](http://localhost:3000) unless
you changed it in the .env file. User is admin, password is admin unless you changed it in the .env file. It is
recommended you change the admin username and password if Libre Photos is going to be publicly accessible via the `.env`
file.

## Next Steps

Next, take a look at the [first steps after setup]({% post_url user_guide/0000-02-01-first_steps %}).
