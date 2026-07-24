---
title: "🔗 Sharing"
description: "Share photos and albums with other users or publicly via links"
sidebar_position: 5
---

LibrePhotos offers multiple ways to share your photos and albums — with other users on your instance, or publicly with anyone via a link.

## The Sharing Page

The **Sharing** page (accessible from the navigation) is your central hub for all sharing activity. It provides an overview of:

- **Public photos** — Other users on your instance who have made their profile public
- **Shared with you** — Photos and albums that others have shared with you
- **You shared** — Photos and albums you have shared with others
- **Public Links** — Albums and photos you've shared publicly via link

## Sharing Albums with Users

You can share any user album with other users on your LibrePhotos instance:

1. Navigate to the album you want to share
2. In the toolbar above the photo grid, open the **three-dot menu** (⋮) and, under **Album Actions**, choose **"Sharing"** — no photo selection is needed
3. Search for users and toggle sharing on or off for each

You can also open the same dialog from the share action on the album's card under **Albums**. The toolbar only appears on albums that already contain at least one photo.

Shared albums show up in the recipient's sharing area: they open **Sharing**, click the **Shared with you** tile, then the **Albums** tab (the page is titled *Albums others shared*).

## Sharing Photos with Users

You can share individual photos (or a selection of photos) with other users:

1. Select one or more photos from any view
2. Click the **three-dot menu** (⋮) and, under **Photo Actions**, choose **"Sharing"**
3. Search for users and toggle sharing on or off for each

Shared photos show up in the recipient's sharing area, grouped by the person who shared them: they open **Sharing**, click the **Shared with you** tile, then the **Photos** tab (the page is titled *Photos others shared*).

## Public Album Sharing via Link

You can create a public link for any user album, making it accessible to anyone — even people without an account on your LibrePhotos instance.

### Creating a Public Link

1. Navigate to the album you want to share publicly
2. Open the sharing dialog (three-dot menu → **"Sharing"**)
3. Toggle **"Public sharing"** on
4. A unique URL slug is generated automatically

The public album is accessible at `https://your-instance/public/s/{slug}`.

### Configuring Public Link Settings

When public sharing is enabled, click **Show settings** in the sharing dialog to expand the configuration panel. From there you can configure:

#### Custom Slug
Change the URL slug to something memorable — 3–64 characters using only lowercase letters, digits and hyphens. Capitals you type are converted to lowercase automatically; spaces, underscores and other punctuation are rejected. Slugs must be unique across the instance, and the field checks availability as you type. For example: `summer-vacation-2025` → `/public/s/summer-vacation-2025`.

#### Expiration
Expiration is optional. Pick any expiry date and time with the date picker (down to the second), or use the built-in **7 days**, **30 days** or **90 days** presets in the picker's dropdown for a quick choice. Click **Never** (or clear the field) to remove the expiry so the link never expires. After expiration, the link no longer works.

#### Photo Details

The **Photo Details** panel fine-tunes what information visitors can see when they open a photo in a public album:

| Setting | What it controls |
|---------|-----------------|
| **Share photo timestamps** | Whether photo dates and times are visible |
| **Share location information** | Whether GPS coordinates and place names are shown |
| **Share camera information** | Whether camera model, lens, focal length, aperture, ISO, and shutter speed are shown |
| **Share captions** | Whether AI-generated or manual captions are visible |
| **Share detected faces** | Whether recognized people's names are displayed |

Each of these settings can be toggled independently per album. When left unset, the **user-level defaults** from your settings are used; you can configure those in **Settings → Public Sharing Defaults**.

**All five are off by default** — both as the built-in fallback and as the initial value of your user-level defaults, following a privacy-first, opt-in approach. So on a brand-new public link, visitors don't see any of these per-photo details until you turn the relevant options on.

:::caution
Changes to the slug, expiration and Photo Details settings are **not applied until you click "Save link settings"** at the bottom of the settings panel. That button stays disabled until you change something; the **Public sharing** toggle itself only saves the on/off state.
:::

### The Public Album Experience

Visitors to a public album link see:

- A photo grid with the album's photos
- A lightbox viewer for browsing individual photos
- Photo details (subject to the album's Photo Details settings)
- No login required

## Making Individual Photos Public

Besides sharing whole albums, you can make individual photos public without putting them in an album:

1. Select one or more photos from any view
2. Click the **three-dot menu** (⋮) and, under **Photo Actions**, choose **"Make Public"**

When you select photos individually, direct image links (`https://your-instance/media/photos/<hash>.jpg`) are copied to your clipboard so you can paste them straight away. In *select all* mode the photos are still made public, but no links are copied.

These are raw image-file URLs, so they behave differently from public album links. There is no album page, no custom slug, no expiration and no Photo Details toggles — anyone with the link can open the image file directly. If you need those controls, share a public album instead.

Public photos appear under the **Photos** tab of your **Public Links** page, on your public profile at `https://your-instance/public/<username>`, and in your own [My Public Photos](./viewing-photos.md#my-public-photos) view.

To reverse this, select the photos again and choose **"Make Private"** from the same menu.

:::caution
Making a photo private stops it from being served through the public views, but it cannot retroactively invalidate a direct link that someone has already opened or saved a copy of the image from.
:::

## Managing Your Shared Content

### Shared By Me

Open **Sharing** and click the **You shared** tile (the pages are titled *Photos you shared* and *Albums you shared*) to see:

- **Photos tab** — All photos you've shared, grouped by recipient
- **Albums tab** — All albums you've shared, grouped by recipient

### Shared With Me

Open **Sharing** and click the **Shared with you** tile (the pages are titled *Photos others shared* and *Albums others shared*) to see:

- **Photos tab** — Photos others have shared with you, grouped by sender
- **Albums tab** — Albums others have shared with you, grouped by sender

### Public Links

Open **Sharing** and click the **Public Links** tile to see everything you've made publicly accessible. It has two tabs: **Albums** (albums with a public link) and **Photos** (individual photos you've marked public).

## Public User Profiles

Users can make their profile publicly accessible by enabling **Public Sharing** in their profile settings. Other users on the instance can then find them in the **Public photos** section of the **Sharing** page, which lists every user with public sharing enabled along with their public photo count. A user's public photos are browsable at `https://your-instance/public/<username>`.
