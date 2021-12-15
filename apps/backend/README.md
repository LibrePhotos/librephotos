[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=LibrePhotos_ownphotos&metric=alert_status)](https://sonarcloud.io/dashboard?id=LibrePhotos_ownphotos) ![Discord](https://img.shields.io/discord/784619049208250388?style=plastic) ![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com)
[![Read the docs](https://img.shields.io/static/v1?label=Read&message=the%20docs&color=blue&style=plastic)](https://docs.librephotos.com/) ![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)
<a href="https://hosted.weblate.org/engage/librephotos/">
<img src="https://hosted.weblate.org/widgets/librephotos/-/librephotos-frontend/svg-badge.svg" alt="Translation status" />
</a>

# LibrePhotos

![](https://github.com/LibrePhotos/librephotos/blob/dev/screenshots/mockups_main_fhd.png?raw=true)
<sub>Mockup designed by rawpixel.com / Freepik</sub>
## Screenshots

![](https://github.com/librephotos/librephotos/blob/dev/screenshots/photo_manage.png?raw=true)
![](https://github.com/librephotos/librephotos/blob/dev/screenshots/photo_info_fhd.png?raw=true)
![](https://github.com/librephotos/librephotos/blob/dev/screenshots/more_to_discover.png?raw=true)

## Live demo
Live [demo available here](https://demo2.librephotos.com/).
User is demo, password is demo1234.

## Communication
You can join our [Discord](https://discord.gg/xwRvtSDGWb).

## What is it?

- LibrePhotos is a fork of Ownphotos
- A self-hosted open source photo management service, with a slight focus on cool graphs
- Django backend and React frontend

### Installation
Step-by-step installation instructions are available in our [documentation](https://docs.librephotos.com/1/standard_install/)

### Alternative Linux installation scripts
see : [librephotos-linux](https://github.com/LibrePhotos/librephotos-linux)

### Contributions
- Get started contributing in less than 30 minutes by following the [guide here](https://github.com/LibrePhotos/librephotos-docker)
- Join our discord server, or open a pull request to start contributing

**Currently the project is in very early stages, some bugs may exist. If you find any please log an issue**

### Features

  - Support for all types of photos including raw photos
  - Support for videos
  - Timeline view
  - Scans pictures on the file system
  - Multiuser support
  - Generate albums based on events like "Thursday in Berlin"
  - Face recognition / Face classification
  - Reverse geocoding
  - Object / Scene detection
  - Semantic image search
  - Search by metadata

## What does it use?

- **Image Conversion:** [ImageMagick](https://github.com/ImageMagick/ImageMagick) 
- **Video Conversion:** [FFmpeg](https://github.com/FFmpeg/FFmpeg)
- **Exif Support:** [ExifTool](https://github.com/exiftool/exiftool)
- **Face detection:** [face_recognition](https://github.com/ageitgey/face_recognition) 
- **Face classification/clusterization:** scikit-learn
- **Image captioning:** [im2txt](https://github.com/HughKu/Im2txt), 
- **Scene classification** [places365](http://places.csail.mit.edu/)
- **Reverse geocoding:** [Mapbox](https://www.mapbox.com/): You need to have an API key. First 50,000 geocode lookups are free every month.
