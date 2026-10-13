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

_Not released yet._ Turning off face detection or image captioning also skips their model downloads: the **Download Models** job no longer fetches the face recognition model or the captioning model, and a scan no longer waits for them. That saves the disk space, and an offline server no longer fails a download for a model it never uses. Turning the feature back on downloads the model then: saving the site settings starts the download, and so does the next scan or a click on "Generate caption". Models that were already downloaded stay on disk; delete their folder under `data_models/` by hand if you want the space back (see [Offline Usage](./offline-setup.md#step-2-place-the-models-in-the-correct-location) for where each one lives).

### Site settings switches

_Not released yet._ Every feature in the table except **Embedded media** also has a switch in the site settings, which an admin can change without restarting anything. The two layers combine like this:

- An environment variable set to `false` is a hard off. The feature stays off whatever the site settings say.
- While the environment variable allows a feature (the default), its site setting decides. All of them start on.

| Feature | Site setting |
| --- | --- |
| Video | `VIDEO_ENABLED` |
| Face detection | `FACE_DETECTION_ENABLED` |
| Face clustering | `FACE_CLUSTER_ENABLED` |
| Image captioning | `IMAGE_CAPTIONING_ENABLED` |
| Reverse geocoding | `REVERSE_GEOCODING_ENABLED` |
| Things (scene classification) | `SCENE_CLASSIFICATION_ENABLED` |

For now the switches are on the Django admin's **Constance › Config** page (`/api/django-admin/constance/config/`); a Features card in **Site Settings** follows. A change applies to the next file, photo or job. Background workers take up to a minute to see it, and so does the watchdog that starts and stops the face recognition and captioning services. Turning a feature off does not delete the faces, captions, tags or places it already produced.

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

Some features are not switched with environment variables, but by an administrator in the app, under **Account menu > Admin Area > Site settings**. A change there takes effect without a restart.

- **Captioning Model**: `None` turns automatic captioning off. _Not released yet:_ it also keeps the captioning service stopped and the captioning model from being downloaded; picking the model again downloads it when you save. See [Image Captioning](./image-captioning.md). The `FEATURE_IMAGE_CAPTIONING` variable above switches it off for the whole deployment instead.
- **Text Recognition (OCR) Model**: `None`, the default, keeps text recognition off and its service stopped. Text that was already read stays searchable. See [Text Recognition (OCR)](./text-recognition.md#turning-it-off).
- **Map Tiles**: `None (hide map)` hides the maps, so map backgrounds are never loaded from an outside server. See [Site Settings](./settings/index.md#site-settings).

Single sign-on is switched on with the `OIDC_*` environment variables, which are not feature toggles. See [Single Sign-On](./settings/single-sign-on.md).

## Running with minimal machine learning {#minimal-machine-learning}

_Not released yet._ On a small server, or one without Internet access, you can turn off the machine learning you do not need. Set these in your `.env` (or the site settings switches above):

- `FEATURE_FACE_DETECTION=false`: no face detection, no face recognition service, no face recognition model download.
- `FEATURE_IMAGE_CAPTIONING=false` (or **Captioning Model** `None`): no automatic captions, no captioning service, no captioning model download (about 370 MB).
- `FEATURE_SCENE_CLASSIFICATION=false`: no tags for the Things albums.
- Leave **Text Recognition (OCR) Model** at `None`, the default: no OCR service and no OCR model download.

What still runs and is still downloaded: OpenCLIP ViT-B/32 (about 600 MB). It makes the embeddings behind semantic search and similar photos, so the `tags` service keeps running even with Things turned off, and there is no switch for it. The thumbnail, EXIF and similarity services also keep running; they hold no large models. There is no separate image without the machine learning runtime.
