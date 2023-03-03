---
title: "💻 Local"
excerpt: "How to install Libre Photos locally on Debian-based operating systems."
sidebar_position: 4
---

LibrePhotos can be installed locally on Debian-based operating systems with systemd.

## Notes

We currently only support nginx. If you want something custom adapt the script to your liking.
We do not support a remote postgresql server yet.
If REDIS present on the system AND connection to it through socket, change socket permissions to 770. librephotos user will be added to redis group.

## Compatibility

Architecture:
amd64

- Ubuntu 20.04.x LTS (server)
- Ubuntu 21.04 (desktop)
- Debian

## Pre-Installation

Install git:

```
sudo apt install git -y
```

## Installation

### Debian like distribution

Execute the following commands as root. Edit the begining of the script, and execute. This will create systemuser 'librephotos', creates directories, installs necessary software, creates database and automaGically writes some variables to librephotos-backend.env file.

```
sudo su
cd
git clone https://github.com/LibrePhotos/librephotos-linux.git
cd librephotos-linux
nano install-librephotos.sh
```

```
./install-librephotos.sh
```

After changing the photos directory, you must edit either `/etc/nginx/nginx.conf` or `/etc/nginx/sites-available/librephotos`. There are four places where you have to update the location.

```
nano /etc/librephotos/librephotos-backend.env
```

## Additional information

Installed systemd services:

```
librephotos-image-similarity.service
librephotos-worker.service
librephotos-backend
librephotos-frontend
```

### librephotos-cli

As root you can use

```
librephotos-cli build_similarity_index
librephotos-cli clear_cache
```

### Video are not playing

This is a permissions issue. The subdirectories need others read and execute permissions and the video files need others read permissions. This is true even if everything is owned by librephotos:librephotos

## Next Steps

Next, take a look at the [first steps after setup]({% post_url user_guide/0000-02-01-first_steps %}).
