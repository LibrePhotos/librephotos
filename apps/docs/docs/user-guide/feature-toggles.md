---
title: "✅ Feature Toggles"
excerpt: "LibrePhotos feature toggles"
sidebar_position: 6
---

## LibrePhotos feature toggles

In some cases you might want to enable or disable certain LibrePhotos features to preserve hardware resources or make use of some more advanced features. You can do that by referring to the following table.

Feature toggles are implemented as environment variables you would have to configure before starting up backend.

<table>
  <tr>
    <th>Feature</th>
    <th>Description</th>
    <th>Status</th>
    <th>Variable to enable the feature</th>
  </tr>
  <tr>
    <td>Embedded media</td>
    <td>
      Extract embedded media from "live photos"
    </td>
    <td>🟢</td>
    <td>
      FEATURE_PROCESS_EMBEDDED_MEDIA=True
    </td>
  </tr>
</table>

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
