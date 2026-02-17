---
title: "📁 Albums"
excerpt: "Managing your photo albums in LibrePhotos"
sidebar_position: 5
---

# Albums

LibrePhotos supports several types of albums to help you organize your photo library.

## Album Types

### User Albums (My Albums)
Albums you create manually to organize photos however you like. You can add any photos to these albums.

### People Albums
Automatically generated albums based on face recognition. Each recognized person gets their own album.

### Auto Albums (Events)
Automatically generated albums based on time and location patterns in your photos.

### Places Albums
Automatically generated albums based on the GPS location data in your photos.

### Things Albums
Automatically generated albums based on detected objects and scenes in your photos. Things Albums are filtered by the currently active **Tagging Model** (configurable in Site Settings), so only tags from the selected model are shown. Switching models instantly updates which Things Albums are visible.

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
2. **Select exactly one photo** by clicking on it (you'll see a checkmark appear)
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

## Sharing Albums

User Albums can be shared with other users on your LibrePhotos instance, or publicly via a link. For full details on all sharing features, see the [Sharing guide](./sharing.md).

1. Navigate to the User Album you want to share
2. Select any photo to activate the selection toolbar
3. Click the **three-dot menu** (⋮)
4. Under "Album Actions", click **"Sharing"**
5. Search for and select the users you want to share with

---

## Public Sharing via Link

You can share albums publicly with anyone via a unique link, without requiring them to have an account on your LibrePhotos instance:

1. Navigate to the User Album you want to share publicly
2. Go to the **Sharing** page from the navigation
3. Click **"Create Public Link"** for the album
4. A unique URL slug will be generated that you can share with anyone
5. Configure **privacy settings** for the public link to control what information is visible:
   - Location data
   - Camera information
   - Timestamps
   - Captions
   - Recognized faces

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

