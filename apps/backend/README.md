[![Discord](https://img.shields.io/discord/784619049208250388?style=plastic)][discord] [![Website](https://img.shields.io/website?down_color=lightgrey&down_message=offline&style=plastic&up_color=blue&up_message=online&url=https%3A%2F%2Flibrephotos.com)](https://librephotos.com/)
[![Read the docs](https://img.shields.io/static/v1?label=Read&message=the%20docs&color=blue&style=plastic)](https://docs.librephotos.com/) [![GitHub contributors](https://img.shields.io/github/contributors/librephotos/librephotos?style=plastic)](https://github.com/LibrePhotos/librephotos/graphs/contributors)
<a href="https://hosted.weblate.org/engage/librephotos/">
<img src="https://hosted.weblate.org/widgets/librephotos/-/librephotos-frontend/svg-badge.svg" alt="Translation status" />
</a>

# LibrePhotos

![](https://github.com/LibrePhotos/librephotos/blob/dev/screenshots/mockups_main_fhd.png?raw=true)
<sub>Mockup designed by rawpixel.com / Freepik</sub>

- **Stable** demo is available here:https://demo1.librephotos.com/ . User is ```demo```, password is ```demo1234``` (with sample images).
- Latest **development** demo is available here: https://demo2.librephotos.com/ (same user/password)
- You can watch development videos on [Niaz Faridani-Rad's channel](https://www.youtube.com/channel/UCZJ2pk2BPKxwbuCV9LWDR0w)
- You can join our [Discord][discord].

## Installation

Step-by-step installation instructions are available in our [documentation](https://docs.librephotos.com/docs/installation/standard-install)

## How to help out
- ⭐ **Star** this repository if you like this project!
- 🚀 **Developing**: Get started in less than 30 minutes by following [this guide](https://docs.librephotos.com/docs/development/dev-install).
- 🗒️ **Documentation**: Improving the documentation is as simple as submitting a pull request [here](https://github.com/LibrePhotos/librephotos.docs)
- 🧪 **Testing**: If you want to help find bugs, use the ```dev``` tag and update it regularly. If you find a bug, open an issue.
- 🧑‍🤝‍🧑 **Outreach**: Talk about this project with other people and help them to get started too!
- 🌐 **Translations**: Make LibrePhotos accessible to more people with [weblate](https://hosted.weblate.org/engage/librephotos/).
- 💸 [**Donate**](https://github.com/sponsors/derneuere) to the developers of LibrePhotos

## Features

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
- **Face classification/clusterization:** [scikit-learn](https://scikit-learn.org/) and [hdbscan](https://github.com/scikit-learn-contrib/hdbscan)
- **Image captioning:** [im2txt](https://github.com/HughKu/Im2txt), 
- **Scene classification** [places365](http://places.csail.mit.edu/)
- **Reverse geocoding:** [Mapbox](https://www.mapbox.com/): You need to have an API key. First 50,000 geocode lookups are free every month.

[discord]: https://discord.gg/xwRvtSDGWb
