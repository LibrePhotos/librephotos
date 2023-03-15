---
title: "Introduction"
excerpt: "A self-hosted open source photo management service."
sidebar_position: 1
---

![](../static/img/mockups_main_fhd.png)
<sub>Mock-up designed by rawpixel.com / Freepik</sub>

Unlike commercial service that store your photos in the cloud and scan/index them to train their machine learning models and collect ad targeting data on you, LibrePhotos keeps all your photos and metadata on your local machine. Your data is never sent to or stored on a 3rd party server. Get the same power as those commercial services without giving up your personal data and privacy.

## Features

- Support for all types of photos, including raw photos
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
- **EXIF Support:** [ExifTool](https://github.com/exiftool/exiftool)
- **Face detection:** [face_recognition](https://github.com/ageitgey/face_recognition)
- **Face classification/clusterization:** scikit-learn
- **Image captioning:** [im2txt](https://github.com/HughKu/Im2txt),
- **Scene classification** [places365](http://places.csail.mit.edu/)
- **Reverse geocoding:** [Mapbox](https://www.mapbox.com/): You need to have an API key. The first 50,000 geocode lookups are free every month.
