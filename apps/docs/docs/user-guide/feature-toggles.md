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
