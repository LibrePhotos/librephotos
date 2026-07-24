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
    <td>Scene classification</td>
    <td>
      Tag photos by what is in them (beach, kitchen, sunset, ...)
    </td>
    <td>🟢</td>
    <td>
      FEATURE_SCENE_CLASSIFICATION=true
    </td>
  </tr>
</table>

All of these default to on. See [Advanced docker-compose usage](../installation/environment-variables.md) for what turning each one off actually stops, and for the matching `.env` keys of the bundled Compose setup.

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
