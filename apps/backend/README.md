[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)

# LibrePhotos

![](https://github.com/sysoppl/librephotos/blob/update-screenshots/screenshots/mockups_main_fhd.png?raw=true)
<sub>Mockup designed by rawpixel.com / Freepik</sub>
## Screenshots

![](https://github.com/sysoppl/librephotos/blob/update-screenshots/screenshots/photo_manage.png?raw=true)
![](https://github.com/sysoppl/librephotos/blob/update-screenshots/screenshots/photo_info_fhd.png?raw=true)
![](https://github.com/sysoppl/librephotos/blob/update-screenshots/screenshots/more_to_discover.png?raw=true)

## Live demo
Live [demo available here](https://demo2.librephotos.com/).
User is demo, password is demo1234.

## Communication
You can join us via [IRC](https://webchat.freenode.net/) or [Discord](https://discord.gg/xwRvtSDGWb). There is a bridge between the IRC and Discord:
| Discord            | Freenode IRC          |
|--------------------|-----------------------|
| #chit-chat         | #Libre-Photos         |
| #community-support | #Libre-Photos-Support |
| #dev               | #Libre-Photos-dev     |

## What is it?

- LibrePhotos is a fork of Ownphotos
- Self hosted Google Photos clone, with a slight focus on cool graphs
- Django backend & React frontend. 

### Contributions
- Librephotos is in development. Contributions are welcome!
- Join our discord server or open a pull request to start contributing
- We are looking for developers who want to port LibrePhotos to ARM

**Currently the project is in very early stages, some bugs may exist. If you find any please log an issue**

### Features

#### - Currently implemented:
  
  - Label some faces manually, and train a face classifier to label the rest.
  - View photos by people in them.
  - Automatically generate "event" albums like "Thursday in Berlin"
  - See photos on the map
  - Backend caching
  - View photos grouped by date
  - "Optimized" frontend
  - Detect objects in photos, and make them searchable by objects 
  - Search photos by the location 
  - Authentication (using JWT)
  - Create custom albums
  - Docker ready
  
#### - Upcoming

  - Short term:
    - Share photos/albums
    - Stability

  - Longer term, i.e. haven't thought much about them
    - Basic photo editing, like rotation
    - Tag undetected face
    - Add cool graphs

## What does it use?

- **Face detection:** [face_recognition](https://github.com/ageitgey/face_recognition) 
- **Face classification/clusterization:** scikit-learn
- **Object detection:** [densecap](https://github.com/jcjohnson/densecap), [places365](http://places.csail.mit.edu/)
- **Reverse geocoding:** [Mapbox](https://www.mapbox.com/): You need to have an API key. First 50,000 geocode lookups are free every month.


## How do I run it?

### Compatibility
You need a x86 processor and it is recommended to have 8GBs of RAM.
**It does not work on ARM processors.** That also means that it won't run on a raspberry pi.

### Size
You will need at least 10 GB of HDD Space for the docker images. It needs that space because of the machine learning models.
Librephotos will also create a database and thumbnails which will need additional space.

### Docker

LibrePhotos comes with separate backend and frontend
servers. The backend serves the restful API, and the frontend serves, well,
the frontend. They are connected via a proxy.
The easiest way to do it is using Docker.

## Docker-compose method (Recommended)

```
wget https://raw.githubusercontent.com/LibrePhotos/librephotos/dev/docker-compose.yml
wget https://raw.githubusercontent.com/LibrePhotos/librephotos/dev/librephotos.env
cp librephotos.env .env

Do not forget to create the directory's you specified in the ``.env`` file if they do not exist. 
```

Open `.env` in your favorite text editor and make the required changes.

```
docker-compose up -d
```

You should have librephotos accessible after a few minutes of bootup on: [localhost:3000](http://localhost:3000) unless you changed it in the .env file.
User is admin, password is admin unless you changed it in the .env file. It is recommended you change the admin username and password if Libre Photos is going to be publicly accessible via the ``.env`` file.

## First steps after setting up

You need to log in as the admin user, and set up the directory for the users. To do this, click the top right button, and go to "Admin Area". On this page, it will show a list of users, and manually set the "Scan Directory" for the desired user. Only an admin can do this. And then you can go to Dashboard - Library and click the Green "Scan photos (file system)" button. If you have a Nextcloud instance, you can also input this in the Dashboard-Library page. Once logged in (the little circle next to "Nextcloud Scan Directory will be green), you can choose a top level directory in your logged in Nextcloud account. Once this works, you can click the blue "Scan photos (Nextcloud)". The backend system will copy the contents of the Nextcloud directory you specified. 

The basic idea is this:

- For scanning photos that reside in the local file system
  - Only the admin user can change the "scan directory" of the users, including the admin itself.
  - Normal users cannot change his/her own "scan directory"
  - Only the admin can find the page to control this under the "user icon (top right) - admin area"
- For scaning photos that reside in external Nextcloud instances
  - Any user can change his/her own Nextcloud endpoint, and choose a top level directory in the Nextcloud account.
