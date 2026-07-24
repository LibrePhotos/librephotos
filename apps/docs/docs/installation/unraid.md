---
title: "📦 unRAID"
description: "How to install LibrePhotos on Unraid using Docker Compose."
sidebar_position: 3
---

## Docker Compose

You have to download docker-compose. You can add the following to your /boot/config/go file to make sure it's always available:

```bash
curl -L "https://github.com/docker/compose/releases/download/v2.5.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

Check if it's working:

```bash
docker-compose --version
```

You'll need to create a folder under /mnt/user (e.g. librephotos) within there you'll need two files:

```bash
mkdir /mnt/user/librephotos && cd /mnt/user/librephotos
```

Download this file and save it as .env:

```bash
wget -O .env https://raw.githubusercontent.com/LibrePhotos/librephotos/dev/deploy/compose/librephotos.env
```

​Download this file to the same directory, but keep the original name:

```bash
wget https://raw.githubusercontent.com/LibrePhotos/librephotos/dev/deploy/compose/docker-compose.yml
```

You'll need to edit the .env file and set the two mandatory variables: `scanDirectory`, the folder holding your photos (e.g. `/mnt/user/pictures`), and `data`, a folder for LibrePhotos' internal state - its database, protected media, logs and model cache (e.g. `/mnt/user/appdata/librephotos`). Create both folders before you start the stack, and keep note of the default HTTP port, 3000.

The map API key is no longer set in this file. After first boot, set it under your avatar -> Admin Area -> Site Settings. See [Old environment variables](environment-variables.md#old-environment-variables) if you'd rather seed it as a first-boot default.

You should have LibrePhotos accessible after a few minutes of boot-up on unraidip:3000 unless you changed this in the .env file.

​Once done, you can fire up the containers by typing:

```bash
docker-compose up -d
```

This will cause the containers to startup in the background. You can check the status of them by running:

```bash
docker logs {container name}
```

You can get a name for each of the containers by typing:

```bash
docker ps | grep librephoto
```

Finally, you can access the UI by going to http://unraidip:3000

Furthermore, you can also monitor progress from the shell prompt by tailing the backend log. It lives at `logs/ownphotos.log` inside the `data` folder you set in .env (with the example above, that is `/mnt/user/appdata/librephotos/logs/ownphotos.log`):

```bash
tail -f /mnt/user/appdata/librephotos/logs/ownphotos.log
```

Or, independent of where you mounted it - the backend container is always named `backend`:

```bash
docker exec backend tail -f /logs/ownphotos.log
```

To shut everything down:

```bash
docker-compose down
```

If you want to grab any updates, run:

```bash
docker-compose down
docker-compose pull
docker-compose up -d
```

Running `docker-compose pull` on its own only downloads the new images; the containers keep running the old ones until they are recreated, so pull the images and then bring the stack back up.

## docker-compose issues when rebooting

After a reboot, docker-compose is not installed anymore, since unRAID loads everything from ram. Someone created a Docker Compose Manager app in the Apps catalog for unRAID. This makes sure docker-compose is installed every time you reboot unRAID, and they are currently working on a Web GUI.

Thanks to [u/Tusc00](https://old.reddit.com/user/Tusc00) and Martijn (Spiek90) for this [write-up](https://old.reddit.com/r/unRAID/comments/knaniy/librephotos/goeyy4l/)!

## Next Steps

Next, take a look at the [first steps after setup](../user-guide/first-steps.md).
