---
title: "🎞 Thumbnails"
excerpt: "How do thumbnails work in LibrePhotos?"
sidebar_position: 5
---

We process media files with different libraries to convert them to a widely compatible format and to speed up previewing files.

## Thumbnail engines

### libvips (images)

By leveraging libvips' lightning-fast image processing capabilities and memory-efficient design, the conversion process becomes remarkably fast, ensuring optimal performance even with numerous images.
Moreover, the utilization of pyvips as a Python interface facilitates seamless integration with the project

### ImageMagick (RAW images)

ImageMagick's robust suite of tools empowers us to perform conversion of raw images on a wide array of file types. When coupled with the wand library, which provides a Pythonic interface to interact with ImageMagick, it's easy to maintain and extend.

Because there are some compatibility issues between ImageMagick and PyTorch, this runs on a separate microservice.

### FFmpeg (video)

As a powerful and versatile multimedia framework, FFmpeg equips users with a comprehensive suite of tools to seamlessly convert videos in various formats. The open-source nature of FFmpeg results in continuous updates and improvements that keep pace with evolving industry standards.

### Source of truth for processing

Big thumbnails act as a source of truth for all subsequent processing like finding faces, calculating similarity, finding objects etc. The reason for that is twofold: First, we know that all files will be compatible with the machine learning pipelines, because it's only one format, second all file dimensions are limited to a certain format, which will prevent a possible explosion of resource use.

### Other thumbnails

We also create thumbnails for previewing the faces and for the avatars of users. This is done to increase the speed of displaying a lot of them.

## Endpoints:

### `GET /media/thumbnails_big/<hash>`

Gives you a large preview of the actual file. It is also an image for videos. If you want to display the video file use `media/photos/<hash>` instead.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /media/square_thumbnails/<hash>`

Gives you a normal preview of the actual file. Can be an image or a video.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /media/small_square_thumbnails/<hash>`

Gives you a small preview. Usually only usable with a blur to indicate loading. Could be replaced by blur hash.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /media/photos/<hash>`

Return the actual image or video from the server.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /media/faces/<hash>_<face_number>.jpg`

Returns the face for an image.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /media/avatars/<first_name>avatar_<hash>.png`

Returns an avatar for a given user.
