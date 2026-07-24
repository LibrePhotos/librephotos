---
title: "🗑️ Trash"
description: "A overview on how Trash works"
sidebar_position: 16
---

### Deleting images

1. Mark file as "deleted". Select the image you want to delete, go to the action button and click on "Move to Trash"
2. Navigate to Trash.
3. Select the images you want to delete forever.
4. Click the red trash icon in the selection bar (tooltip *Delete permanently*, or *Delete N photos permanently* when more than one is selected), then confirm in the **Delete Images** dialog by clicking the red **Delete** button. This cannot be undone.

You can also restore a photo instead of deleting it: select it in Trash and click the blue undo-arrow icon (tooltip *Restore photo*) to remove the "deleted" status.

Deleting the images from the file system only works, if LibrePhotos has the access to the images. If it is read only, files will not be deleted.

### Deleting missing images

Missing images can happen, when you moved files outside of the LibrePhotos photo folder or if you deleted them with a third party tool like the filesystem. In this case the metadata, thumbnail and faces still exist, but the actual file is not known to LibrePhotos.

There are two ways to deal with that:

1. Move the files back to the LibrePhotos folder and do a rescan
2. Delete the metadata of the missing images. On the **Library** page, whenever missing files have been detected, a red **Missing Photos** badge (showing how many) appears next to the *Photos* heading. Click it and confirm in the **Remove missing photos** dialog. This permanently deletes those photos from the database, along with their metadata, faces, ratings, captions and album assignments, and cannot be undone.

See [Missing Photos](./missing-photos.md) for more on how missing files are detected and resolved.
