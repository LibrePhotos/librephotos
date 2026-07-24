---
title: "📁 Albums"
description: "Managing your photo albums in LibrePhotos"
sidebar_position: 4
---

# Albums

LibrePhotos supports several types of albums to help you organize your photo library.

## Album Types

### User Albums (My Albums)
Albums you create manually to organize photos however you like. You can add any photos to these albums.

### People Albums
Automatically generated albums based on face recognition. Each recognized person gets their own album.

### Auto Albums (Events)
Albums that group your photos into events based on when they were taken. Grouping is purely chronological: a photo joins the current event if it was taken less than **1 day and 12 hours** after the previous photo already in that event, so a continuous trip stays a single event however long it runs. An event needs at least two photos — a single photo on its own produces no album. Location and recognized people are not used for the grouping itself; they only feed the album's generated title (for example "Weekend in Paris") and its position on the map.

:::note
Unlike People, Places and Things albums, event albums are **not** created during a scan. To create them, open **Settings → Library**, find the **Event Albums** section and click **Generate** (or run the **Generate Event Albums** command from the search spotlight), and re-run it after importing new photos. **Regenerate Event Titles** only refreshes the titles of existing albums, which is useful once you have named faces or after reverse geocoding has filled in place names. See [Job System](./job-system.md) for the underlying jobs.
:::

### Places Albums
Automatically generated albums based on the GPS location data in your photos.

### Things Albums
Automatically generated albums based on detected objects and scenes in your photos. Things Albums are filtered by the currently active **Tagging Model** (configurable in Site Settings), so only tags from the selected model are shown. Switching models does not delete your existing tags, but it also does not create tags for the newly selected model — until tags exist for that model, the Things section will look empty. To generate them, run a full **Rescan** from **Settings → Library** (in the *Scan Library* section, open the dropdown next to **Scan** and choose **Rescan**), which retags your existing photos. Albums created from `#hashtags` you typed into photo captions are always shown, regardless of the active model.

---

## Setting an Album Cover

You can customize the cover image for **People Albums** and **User Albums**. There are two ways to do this:

### Method 1: Using the Cover Picker (Recommended)

1. Navigate to the album you want to customize (People or User Album)
2. Click the **three-dot menu** (⋮) in the selection toolbar
3. Click **"Set album cover"**
4. A modal will open showing all photos in the album
5. Click on the photo you want to use as the cover
6. The cover is set immediately

:::tip
The cover picker loads photos in batches of 50 for better performance. Click "Load more photos" to see additional photos if your album is large.
:::

### Method 2: Quick Selection (Shortcut)

If you already know which photo you want to use:

1. Navigate to the album
2. **Select exactly one photo** — hover over it and click the checkbox that appears in its top-left corner (a plain click on a photo opens it in the lightbox instead of selecting it)
3. Click the **three-dot menu** (⋮) in the selection toolbar
4. Click **"Set album cover"**
5. The selected photo becomes the cover immediately

:::note
The "Set album cover" option only appears when you're viewing a People Album or User Album. It won't be visible on other pages like the main timeline or auto-generated albums.
:::

---

## Creating User Albums

1. Select one or more photos from any view
2. Click the **plus icon** (+) in the selection toolbar
3. Click **"Album"**
4. Either:
   - Enter a name for a new album and click "Create"
   - Or click on an existing album to add the photos to it

---

## Renaming and Deleting User Albums

On the **Albums** page, every User Album card has a **three-dot menu** (⋮) in its top-right corner. From it you can:

- **Rename** — enter a new title and confirm. Titles must be unique; the dialog blocks a name that another one of your albums already uses.
- **Sharing** — open the album sharing dialog (see the [Sharing guide](./sharing.md)).
- **Delete** — a confirmation dialog appears before the album is removed.

:::caution
Deleting an album is permanent and cannot be undone, but it only removes the album itself. The photos it contained stay in your library.
:::

---

## Sharing Albums

User Albums can be shared with other users on your LibrePhotos instance, or publicly via a link. For full details on all sharing features, see the [Sharing guide](./sharing.md).

1. Navigate to the User Album you want to share
2. Click the **three-dot menu** (⋮) in the selection toolbar
3. Under "Album Actions", click **"Sharing"**
4. Search for and select the users you want to share with

---

## Public Sharing via Link

You can share albums publicly with anyone via a unique link, without requiring them to have an account on your LibrePhotos instance:

1. Navigate to the User Album you want to share publicly
2. Click the **three-dot menu** (⋮) in the selection toolbar and, under "Album Actions", click **"Sharing"**
3. In the dialog, toggle **"Public sharing"** on — a unique URL slug is generated automatically that you can share with anyone
4. Click **"Show settings"** to customize the slug (3–64 characters), set an expiration (7, 30 or 90 days, or never), and control what information visitors can see:
   - Location data
   - Camera information
   - Timestamps
   - Captions
   - Recognized faces

Once an album is public, it appears under **Sharing → Links**, where you can copy the link, open it, or reopen the sharing dialog to change its settings. Albums that are not yet public are not listed there.

Default privacy settings for new public links can be configured in **Settings → Public Sharing Defaults**.

Public albums are accessible at `/public/s/{slug}` and include a lightbox viewer with the same navigation experience as the main app.

---

## Removing Photos from Albums

To remove photos from a User Album:

1. Navigate to the User Album
2. Select the photos you want to remove
3. Click the **three-dot menu** (⋮)
4. Click **"Remove Photos"**

:::caution
This only removes the photos from the album. The original photos remain in your library.
:::

