---
title: "💻 Local"
excerpt: "How to install Libre Photos manually on Debian-based operating systems."
last_modified_at: 2022-03-15
category: 1
---

LibrePhotos can be installed manually on Debian-based operating systems, eliminating the need for Docker Compose.

## Notes

Script is not adopted to remote postgresql server.  
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

Admin password will store in /tmp/ADMIN_PASS.
After changing the photos directory, must edit one of the `/etc/nginx/nginx.conf` or `/etc/nginx/sites-available/librephotos`. There are four places `alias /var/lib/librephotos.

No cheking Apache or any other web server exsistense on system. Please adopt the script. Easiest way to remove all lines, releated with nginx, and create virtual host in Apache.

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

Update database (on the first time this is already done by the script)

```
/usr/lib/librephotos/bin/librephotos-upgrade
```

Create admin user as root with the following command (on the first time this is already done by the script)

```
/usr/lib/librephotos/bin/librephotos-createadmin <user> <email> <pasword>
```

As root you can use

```
librephotos-cli build_similarity_index
librephotos-cli clear_cache
```

## Next Steps

Next, take a look at the [first steps after setup]({% post_url user_guide/0000-02-01-first_steps %}).
