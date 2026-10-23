---
title: "✅ Feature Toggles"
description: "LibrePhotos feature toggles"
sidebar_position: 20
---

## LibrePhotos feature toggles

In some cases you might want to enable or disable certain LibrePhotos features to preserve hardware resources or make use of some more advanced features. You can do that by referring to the following table.

Feature toggles are implemented as environment variables you would have to configure before starting up backend.

<table>
  <tr>
    <th>Feature</th>
    <th>Description</th>
    <th>Status</th>
    <th>Environment variable</th>
  </tr>
  <tr>
    <td>Embedded media</td>
    <td>
      Extract embedded media from "live photos"
    </td>
    <td>🟢</td>
    <td>
      FEATURE_PROCESS_EMBEDDED_MEDIA=true
    </td>
  </tr>
  <tr>
    <td>Video</td>
    <td>
      Import video files during a scan
    </td>
    <td>🟢</td>
    <td>
      FEATURE_VIDEO=true
    </td>
  </tr>
  <tr>
    <td>Animated video previews</td>
    <td>
      <Since version="1.4.0" /> Play a short silent clip of each video in the photo grid
    </td>
    <td>🟢</td>
    <td>
      FEATURE_VIDEO_PREVIEWS=true
    </td>
  </tr>
  <tr>
    <td>Face detection</td>
    <td>
      Find faces in your photos
    </td>
    <td>🟢</td>
    <td>
      FEATURE_FACE_DETECTION=true
    </td>
  </tr>
  <tr>
    <td>Faces in videos</td>
    <td>
      <Since version="1.5.0" /> Find faces in a few frames across each video, not only in its first frame
    </td>
    <td>🟢</td>
    <td>
      FEATURE_FACE_DETECTION_IN_VIDEOS=true
    </td>
  </tr>
  <tr>
    <td>Face clustering</td>
    <td>
      Group the faces that were found into people you can label
    </td>
    <td>🟢</td>
    <td>
      FEATURE_FACE_CLUSTER=true
    </td>
  </tr>
  <tr>
    <td>Image captioning</td>
    <td>
      Describe photos with an automatically generated caption
    </td>
    <td>🟢</td>
    <td>
      FEATURE_IMAGE_CAPTIONING=true
    </td>
  </tr>
  <tr>
    <td>Reverse geocoding</td>
    <td>
      Turn GPS coordinates into place names
    </td>
    <td>🟢</td>
    <td>
      FEATURE_REVERSE_GEOCODING=true
    </td>
  </tr>
  <tr>
    <td>Things (scene classification)</td>
    <td>
      Detect what is in photos (beach, kitchen, sunset, ...) for the Things albums
    </td>
    <td>🟢</td>
    <td>
      FEATURE_SCENE_CLASSIFICATION=true
    </td>
  </tr>
</table>

All of these default to on. See [Advanced docker-compose usage](../installation/environment-variables.md) for what turning each one off actually stops, and for the matching `.env` keys of the bundled Compose setup.

Turning off face detection, image captioning or Things also keeps the matching machine learning service from starting, so its model is never loaded and never restarted by the watchdog. That is where the memory these switches save actually comes from. (Since 1.2.0; on 1.1.0 the switches stop the processing, but the services still start.)

<Since version="1.4.0" /> Turning off face detection or image captioning also skips their model downloads: the **Download Models** job no longer fetches the face recognition model or the captioning model, and a scan no longer waits for them. That saves the disk space, and an offline server no longer fails a download for a model it never uses. Turning the feature back on downloads the model then: saving the site settings starts the download, and so does the next scan or a click on "Generate caption". Models that were already downloaded stay on disk; delete their folder under `data_models/` by hand if you want the space back (see [Offline Usage](./offline-setup.md#step-2-place-the-models-in-the-correct-location) for where each one lives).

### Site settings switches

<Since version="1.4.0" /> Every feature in the table except **Embedded media** also has a switch in the **Features** card, under **Account menu > Admin Area > Site settings**, which an admin can flip without restarting anything. The two layers combine like this:

- An environment variable set to `false` is a hard off. The feature stays off whatever the site settings say, and its switch in the Features card is disabled, with a **Locked** badge and the name of the variable. To turn the feature on, change the variable in your Compose file or `.env` and restart.
- While the environment variable allows a feature (the default), its switch decides. All of them start on.

| Feature | Name in the Features card | Site setting |
| --- | --- | --- |
| Video | Videos | `VIDEO_ENABLED` |
| Animated video previews | Animated previews, under Videos | `VIDEO_PREVIEWS_ENABLED` |
| Face detection | Face detection | `FACE_DETECTION_ENABLED` |
| Faces in videos | Faces in videos, under Face detection | `FACE_DETECTION_IN_VIDEOS_ENABLED` |
| Face clustering | Face clustering | `FACE_CLUSTER_ENABLED` |
| Image captioning | Image captioning | `IMAGE_CAPTIONING_ENABLED` |
| Reverse geocoding | Place names | `REVERSE_GEOCODING_ENABLED` |
| Things (scene classification) | Things | `SCENE_CLASSIFICATION_ENABLED` |

A switch saves as soon as you flip it, like the other site settings. A change applies to the next file, photo or job. Background workers take up to a minute to see it, and so does the watchdog that starts and stops the face recognition and captioning services. Turning a feature off does not delete the faces, captions, Things or place names it already produced.

### Animated video previews {#animated-video-previews}

<Since version="1.4.0" /> By default the photo grid plays a short silent clip of each video while you point at it, and a scan encodes two such clips per video (500 and 250 px high, `VIDEO_PREVIEW_SECONDS` long). On a large library of high-resolution videos that encoding is most of the scan time and of the thumbnail space videos take. Turn off **Animated previews**, the switch under **Videos** in the Features card, and a scan makes two WebP stills of each video's first frame instead, from the big thumbnail it makes anyway: no ffmpeg run, and tens of kilobytes per video where the clips often take hundreds. The grid then shows the still with the play icon and length in its corner, so a video still looks like a video, and opening it plays the whole video as before. The switch is disabled while **Videos** is off.

Videos that already have an animated preview keep it: turning the switch off changes nothing on disk. **Rescan** (in the dropdown next to **Scan**) gives every video the kind of preview the switch asks for, so a rescan after turning the switch off deletes the clips and frees their space, and one after turning it back on encodes the clips again.

<Since version="1.5.0" /> Up to 1.4.0, every video in view loaded its clip, and the stills were only made with the switch off.

With the switch on, a scan makes the two WebP stills as well, and the grid shows a video's still with its length until you rest the pointer on it (or reach it with the keyboard): only then does its clip load and play, and it stops when you move on. A page full of videos so loads small pictures instead of a video player for each of them. Phones and tablets show the still, since there is no pointer to rest, and with reduced motion set on your device the grid never plays the clips. The videos added before 1.5.0 get their stills from the [Make Video Posters](./job-system.md#make-video-posters) job, which runs by itself after the update; until then they play their clip as before.

Face detection, image captioning and Things run on a machine learning model. Under each of these switches a line says whether its model is ready. When a model is missing, saving a switch starts the **Download models** job, and the line shows its progress with a link to the job. If the download fails, the line says so and offers **Retry**.

:::note Embedded media
The **Embedded media** switch is checked only the first time a file is imported. Enabling it on a library that has already been scanned extracts nothing for the photos that are already there, not even with **Rescan All Photos**, which skips extraction for files it has already imported. Only files added afterwards are affected. Turning it off never removes clips that were already extracted; those stay on disk under `protected_media/embedded_media/`.
:::

#### Legend

<table>
  <tr>
    <td>🟢</td>
    <td>Implemented</td>
  </tr>
  <tr>
    <td>🔴</td>
    <td>Planned, not implemented</td>
  </tr>
  <tr>
    <td>🟡</td>
    <td>In progress</td>
  </tr>
  <tr>
    <td>⚪</td>
    <td>Not planned</td>
  </tr>
</table>

## Switches in Site Settings {#switches-in-site-settings}

Besides the Features card [above](#site-settings-switches), some features are switched by a model choice in the app, under **Account menu > Admin Area > Site settings**. A change there takes effect without a restart.

- **Captioning Model**: `None` turns automatic captioning off. <Since version="1.4.0" /> It also keeps the captioning service stopped and the captioning model from being downloaded; picking the model again downloads it when you save. See [Image Captioning](./image-captioning.md). The `FEATURE_IMAGE_CAPTIONING` variable above switches it off for the whole deployment instead.
- **Text Recognition (OCR) Model**: `None`, the default, keeps text recognition off and its service stopped. Text that was already read stays searchable. See [Text Recognition (OCR)](./text-recognition.md#turning-it-off).
- **Map Tiles**: `None (hide map)` hides the maps, so map backgrounds are never loaded from an outside server. See [Site Settings](./settings/index.md#site-settings).

Single sign-on is not a feature toggle: it is switched on in the **Single sign-on** group of the same Site Settings card, once an identity provider is set up. See [Single Sign-On](./settings/single-sign-on.md).

## Running with minimal machine learning {#minimal-machine-learning}

<Since version="1.4.0" /> On a small server, or one without Internet access, you can turn off the machine learning you do not need. Set these in your `.env` (or the site settings switches above):

- `FEATURE_FACE_DETECTION=false`: no face detection, no face recognition service, no face recognition model download.
- `FEATURE_IMAGE_CAPTIONING=false` (or **Captioning Model** `None`): no automatic captions, no captioning service, no captioning model download (about 370 MB).
- `FEATURE_SCENE_CLASSIFICATION=false`: no tags for the Things albums.
- Leave **Text Recognition (OCR) Model** at `None`, the default: no OCR service and no OCR model download.

What still runs and is still downloaded: OpenCLIP ViT-B/32 (about 600 MB). It makes the embeddings behind semantic search and similar photos, so the `tags` service keeps running even with Things turned off, and there is no switch for it. The thumbnail, EXIF and similarity services also keep running; they hold no large models. There is no separate image without the machine learning runtime.
