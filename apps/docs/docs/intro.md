---
title: "Introduction"
description: "A self-hosted open source photo management service."
sidebar_position: 1
---

![](../static/img/mockups_main_fhd.png)
<sub>Mock-up designed by rawpixel.com / Freepik</sub>

Unlike commercial service that store your photos in the cloud and scan/index them to train their machine learning models and collect ad targeting data on you, LibrePhotos keeps all your photos and metadata on your local machine. Your data is never sent to or stored on a 3rd party server. Get the same power as those commercial services without giving up your personal data and privacy.

## Get started

- **[Install LibrePhotos](installation/index.md)** — pick a deployment method and get the server running.
- **[First steps](user-guide/first-steps.md)** — what to do right after your first login.
- **[Development setup](development/index.md)** — build LibrePhotos locally and contribute.

## Features

- Support for all types of photos, including raw photos
- Support for videos
- Live Photos and RAW+JPEG file variant support
- Timeline view
- Scans pictures on the file system
- Multiuser support
- Generate albums based on events like "Thursday in Berlin"
- Face recognition / Face classification
- Reverse geocoding
- Object / Scene detection
- Semantic image search
- Search by metadata (person, file type, lens, camera, path)
- Duplicate detection with perceptual hashing
- Public album sharing via link with fine-grained privacy controls
- Photo details sidebar showing location, people, albums, and similar photos
- Slideshow mode and fullscreen lightbox
- Spotlight search with keyboard navigation

## What does it use?

- **Image Conversion:** [libvips](https://github.com/libvips/libvips)
- **RAW Conversion:** [ImageMagick](https://github.com/ImageMagick/ImageMagick)
- **Video Conversion:** [FFmpeg](https://github.com/FFmpeg/FFmpeg)
- **EXIF Support:** [ExifTool](https://github.com/exiftool/exiftool)
- **Face detection:** [InsightFace](https://github.com/deepinsight/insightface) (SCRFD detector + ArcFace embeddings)
- **Face classification/clusterization:** [scikit-learn](https://scikit-learn.org/) and [hdbscan](https://github.com/scikit-learn-contrib/hdbscan)
- **Image captioning:** [im2txt](https://github.com/HughKu/Im2txt), [BLIP](https://github.com/salesforce/BLIP), and [Moondream 2](https://github.com/vikhyat/moondream)
- **Scene classification / tagging:** [places365](http://places.csail.mit.edu/) (default) or [SigLIP 2](https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX), selectable in the admin site settings
- **Semantic search:** [CLIP](https://huggingface.co/sentence-transformers/clip-ViT-B-32) via [sentence-transformers](https://www.sbert.net/), with embeddings indexed by [FAISS](https://github.com/facebookresearch/faiss) (also powers similar-photo suggestions)
- **Reverse geocoding:** [Nominatim](https://nominatim.openstreetmap.org/) (default) and other providers (Mapbox, MapTiler, OpenCage, TomTom)
