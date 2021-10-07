---
title: "Docker Compose"
excerpt: "How to install Libre Photos using Docker Compose."
last_modified_at: 2021-10-07
category: 1
---
> Currently, the project is in very early stages; some bugs may exist. If you find any, please log an issue

### Compatibility

You need a x86 processor, and it is recommended to have 8GBs of RAM.

#### ARM

You can run this on an ARM processor using the ARM compose templates. Due to limited ram & processing power it will not
be as fast. __ARM Development is still in progress - expect bugs.__

[ARM install instructions can be found here]({% post_url installation/0000-01-02-arm_install %})

### Size

You will need at least 10 GB of HDD Space for the docker images. It needs that space because of the machine learning
models. Librephotos will also create a database and thumbnails which will need additional space.

### Docker

LibrePhotos comes with separate backend and frontend
servers. The backend serves the restful API, and the frontend serves, well,
the frontend. They are connected via a proxy.
The easiest way to do it is using Docker.

## Docker Compose installation (recommended)

Clone the repo: `git clone https://github.com/LibrePhotos/librephotos-docker.git`

Navigate to the librephotos-docker folder: `cd librephotos-docker`

Copy the template variable file (containing options such as the location of your photos): `cp librephotos.env .env`

Open `.env` in your favorite text editor and make the required changes. E.g., using nano: `nano .env`

Do not forget to create the directories you specified in the `.env` file if they do not exist.

Start LibrePhotos with `docker-compose up -d`

You should have LibrePhotos accessible after a few minutes of boot-up on [localhost:3000](http://localhost:3000) 
unless you changed this in the `.env` file.  The username is `admin` & the password is `admin` unless you changed them in the `.env` file.
It is recommended you change the admin username and password if LibrePhotos is going to be publicly accessible. This is done via the `.env` file.