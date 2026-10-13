---
title: "🗑️ Trash"
description: "A overview on how Trash works"
sidebar_position: 17
---

### Deleting images

1. Mark file as "deleted". Select the image you want to delete, go to the action button and click on "Move to Trash"
2. Navigate to Trash.
3. Select the images you want to delete forever.
4. Click the red trash icon in the selection bar (tooltip *Delete permanently*, or *Delete N photos permanently* when more than one is selected), then confirm in the **Delete Images** dialog by clicking the red **Delete** button. This cannot be undone.

You can also restore a photo instead of deleting it: select it in Trash and click the blue undo-arrow icon (tooltip *Restore photo*) to remove the "deleted" status.

Deleting the images from the file system only works, if LibrePhotos has the access to the images. If it is read only, files will not be deleted.

### When a photo was moved to the trash

_Not released yet._ LibrePhotos records the moment a photo goes to the trash, whether you moved it there yourself or resolving a [duplicate](./duplicate-detection.md) did. Restoring the photo clears that date, so moving it to the trash again starts over. Photos that were already in the trash when you updated count as trashed on the date they were last changed.

### Emptying the trash

_Not released yet._ Emptying the trash permanently deletes every photo in **your** trash in one go, as a background job, so a large trash no longer runs into a timeout the way selecting everything and deleting it does. The photos of other users are never touched. Like **Delete permanently**, it deletes the original files from disk, and it cannot be undone. The job shows up in the [job list](./job-system.md#empty-trash) with how far it got. A photo that cannot be deleted (for example on a read-only library) is skipped, stays in the trash, and the job ends as failed with the number of photos it could not delete.

The web app does not have the **Empty trash** button yet; it follows in a later update. Until then, apps can start the job with `POST /api/photosedit/empty-trash/`.

### Deleting photos from the trash automatically

_Not released yet._ An administrator can have LibrePhotos empty the trash on its own: with the site setting `TRASH_RETENTION_DAYS` set to a number of days, a daily task permanently deletes every photo that has been in the trash for longer than that, for all users.

:::danger Automatic deletion removes your original files

The automatic cleanup deletes photos the same way **Delete permanently** does: the original files are deleted from disk, together with their thumbnails, faces and everything else LibrePhotos knows about them. It cannot be undone. Only turn it on if your library has a backup, or if you are sure that what lands in the trash can go.

:::

The setting is `0` by default, which keeps photos in the trash until their owner deletes them. Updating LibrePhotos never turns it on. A photo the cleanup cannot delete is skipped and tried again the next day.

The field for it in **Admin Area > Site Settings** follows in a later update. Until then, an administrator can set `TRASH_RETENTION_DAYS` on the Constance page of the Django admin (`/api/django-admin/`), or through the `trash_retention_days` key of `POST /api/sitesettings`.

### Deleting missing images

Missing images can happen, when you moved files outside of the LibrePhotos photo folder or if you deleted them with a third party tool like the filesystem. In this case the metadata, thumbnail and faces still exist, but the actual file is not known to LibrePhotos.

There are two ways to deal with that:

1. Move the files back to the LibrePhotos folder and do a rescan
2. Delete the metadata of the missing images. On the **Library** page, whenever missing files have been detected, a red **Missing Photos** badge (showing how many) appears next to the *Photos* heading. Click it and confirm in the **Remove missing photos** dialog. This permanently deletes those photos from the database, along with their metadata, faces, ratings, captions and album assignments, and cannot be undone.

See [Missing Photos](./missing-photos.md) for more on how missing files are detected and resolved.
