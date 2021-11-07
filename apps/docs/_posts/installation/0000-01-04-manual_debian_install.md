---
title: "Local"
excerpt: "How to install Libre Photos manually on Debian-based operating systems."
last_modified_at: 2021-06-21
category: 1 
---

LibrePhotos can be installed manually on Debian-based operating systems, eliminating the need for Docker Compose.

## Compatibility
  - Debian 11
  - Ubuntu 20.04

## Pre-Installation

### requirement 
  - postgresql
  - redis

### for local postgresql and redis

Install postgresql and redis

~~~
apt install postgresql redis
~~~

### Postgresql database creation script

Open sql console
~~~
su - postgres -c /usr/bin/psql
~~~

Execute the following script, changing values like password and username (you will input these on the config .env file)

~~~
CREATE USER librephotos WITH PASSWORD 'password';
CREATE DATABASE "librephotos" WITH OWNER "librephotos" WITH TEMPLATE = template0 ENCODING = "UTF8";
GRANT ALL privileges ON DATABASE librephotos TO librephotos;
quit
~~~

## Installation

### Debian like distribution

Execute the following command as root
~~~
cd /tmp/
git clone https://github.com/LibrePhotos/librephotos-linux.git
cd librephotos-linux
./install-librephotos.sh 
~~~

An alternative would be to directly download the archive
~~~
wget https://github.com/librephotos/librephotos-linux/archive/main.zip -O /tmp/main.zip
unzip -d /tmp/ /tmp/main.zip
cd /tmp/librephotos-linux-main/
./install-librephotos.sh
~~~

Edit /etc/librephotos/librephotos-backend.env to store configuration variables, such as:

 - SECRET_KEY

 - Postgresql information:
~~~
DB_HOST=localhost
DB_PORT=5432
DB_NAME=YOURDBNAME
DB_USER=YOURUSER
DB_PASS=YOURPASSWORD
~~~

 - redis information
In case you configured it with a password or are using a special path.

 - Mapbox API Key
MAPBOX_API_KEY=YOURAPIKEY

~~~
nano /etc/librephotos/librephotos-backend.env
~~~

Create or update database
~~~
/usr/lib/librephotos/bin/librephotos-upgrade
~~~

Create admin user as root with the following command
~~~
/usr/lib/librephotos/bin/librephotos-createadmin <user> <email> <pasword>
~~~

reboot or start services
~~~
systemctl start librephotos-image-similarity.service
systemctl start librephotos-worker.service
systemctl start librephotos-backend
systemctl start librephotos-frontend
~~~

### Other distribution

not working yet

## additional information

### librephotos-cli

As root you can use 

~~~
librephotos-cli build_similarity_index
librephotos-cli clear_cache
~~~

### Samba mount point example

Install cifs-utils :

~~~
apt install cifs-utils
~~~

In /etc/fstab add the following line :

~~~

//data.lan.lgy.fr/ftcl/photos/ /var/lib/librephotos/data/photos cifs uid=librephotos,gid=librephotos,credentials=/etc/samba/smbcredentials,iocharset=utf8,file_mode=0777,dir_mode=0777,sec=ntlmssp,noacl 0 0
~~~

create file /etc/samba/smbcredentials with connection information like the following

~~~
username=thomas
password=mypassword
domain=my.domain.com
~~~

## Next Steps

Next, take a look at the [first steps after setup]({% post_url user_guide/0000-02-01-first_steps %}).
