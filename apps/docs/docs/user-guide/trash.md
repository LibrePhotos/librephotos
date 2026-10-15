---
title: "🗑️ Trash"
description: "A overview on how Trash works"
sidebar_position: 17
---

### Deleting images

1. Mark file as "deleted". Select the image you want to delete, go to the action button and click on "Move to Trash"
2. Navigate to Trash.
3. Select the images you want to delete forever (click **Select** at the right of the header, or tick a photo's checkbox; the selection bar appears under the header).
4. Click the red trash icon in the selection bar (tooltip *Delete permanently*, or *Delete N photos permanently* when more than one is selected), then confirm in the **Delete N photos permanently?** dialog by clicking its red button. This cannot be undone.

You can also restore a photo instead of deleting it: select it in Trash and click the blue undo-arrow icon (tooltip *Restore photo*) to remove the "deleted" status.

Deleting the images from the file system only works, if LibrePhotos has the access to the images. If it is read only, files will not be deleted.

:::info Not released yet

The trashed-on date, the **Empty trash** button and the automatic deletion described below come with the next release.

:::

### When a photo was moved to the trash

LibrePhotos records the moment a photo goes to the trash, whether you moved it there yourself or resolving a [duplicate](./duplicate-detection.md) did. Restoring the photo clears that date, so moving it to the trash again starts over. Photos that were already in the trash when you updated count as trashed on the date they were last changed.

Open a trashed photo and its details say **Moved to the trash on** that date: in the lightbox's info panel, under the photo's date, and on the photo page, in the red "This photo is in the trash" box above the actions. When an administrator has turned on [automatic deletion](#deleting-photos-from-the-trash-automatically), a second line says **Deleted for good in N days, on** the date the cleanup removes it (red from three days before), or **Deleted for good at the next daily cleanup** once that date has passed.

The subtitle of the Trash page says which rule applies: **Photos in the trash are deleted for good after N days**, or **Photos stay in the trash until you empty it** while automatic deletion is off.

### Emptying the trash

The red **Empty trash** button in the header of the Trash page (a red icon on a phone) permanently deletes every photo in **your** trash in one go. The photos of other users are never touched.

1. Click **Empty trash**. The **Empty the trash?** dialog says how many photos and videos are in the trash. The count is always the whole trash: when the Photos/Videos filter hides some of them, the dialog says how many of them it includes.
2. Click the red **Empty trash** button in the dialog to start, or **Cancel**.

Like **Delete permanently**, it deletes the original files from disk, and it cannot be undone. It runs as a background job, so a large trash no longer runs into a timeout the way selecting everything and deleting it does. While it runs the button says **Emptying the trash**; the job shows up in the [job list](./job-system.md#empty-trash) with how far it got. When it is done, a message says how many photos were deleted. A photo that cannot be deleted (for example on a read-only library) is skipped and stays in the trash; the job then ends as failed, and the message says how many photos are left.

### Deleting photos from the trash automatically

An administrator can have LibrePhotos empty the trash on its own: in **Admin Area > Site Settings**, **Delete photos from the trash after** takes a number of days. A daily task then permanently deletes every photo that has been in the trash for longer than that, for all users.

:::danger Automatic deletion removes your original files

The automatic cleanup deletes photos the same way **Delete permanently** does: the original files are deleted from disk, together with their thumbnails, faces and everything else LibrePhotos knows about them. It cannot be undone. Only turn it on if your library has a backup, or if you are sure that what lands in the trash can go.

:::

The setting is `0` days by default, which keeps photos in the trash until their owner deletes them. Updating LibrePhotos never turns it on. While it is on, a red box under the field says that original files are deleted. Turning it on, or making the number of days smaller, asks first: the **Delete old photos from the trash automatically?** dialog says how many photos, in how many users' trash, the next daily cleanup would delete. Making the number larger, or setting it back to `0`, saves without asking.

A photo the cleanup cannot delete is skipped and tried again the next day. Apps and scripts can read the setting as `trash_retention_days` from `GET /api/sitesettings` and change it (administrators only) with `POST /api/sitesettings`.

### Deleting missing images

Missing images can happen, when you moved files outside of the LibrePhotos photo folder or if you deleted them with a third party tool like the filesystem. In this case the metadata, thumbnail and faces still exist, but the actual file is not known to LibrePhotos.

There are two ways to deal with that:

1. Move the files back to the LibrePhotos folder and do a rescan
2. Delete the metadata of the missing images. On the **Library** page, whenever missing files have been detected, a red **Missing Photos** badge (showing how many) appears next to the *Photos* heading. Click it and confirm in the **Remove missing photos** dialog. This permanently deletes those photos from the database, along with their metadata, faces, ratings, captions and album assignments, and cannot be undone.

See [Missing Photos](./missing-photos.md) for more on how missing files are detected and resolved.
