---
title: "🔗 Sharing"
excerpt: "Share photos and albums with other users or publicly via links"
sidebar_position: 9
---

LibrePhotos offers multiple ways to share your photos and albums — with other users on your instance, or publicly with anyone via a link.

## The Sharing Page

The **Sharing** page (accessible from the navigation) is your central hub for all sharing activity. It provides an overview of:

- **Public Users** — Other users on your instance who have made their profile public
- **Shared With You** — Photos and albums that others have shared with you
- **You Shared** — Photos and albums you have shared with others
- **Public Links** — Albums you've shared publicly via link

## Sharing Albums with Users

You can share any user album with other users on your LibrePhotos instance:

1. Navigate to the album you want to share
2. Select any photo to activate the selection toolbar
3. Click the **three-dot menu** (⋮) → **"Sharing"**
4. Search for users and toggle sharing on or off for each

Shared albums appear in the recipient's **Sharing → Shared With Me → Albums** section.

## Sharing Photos with Users

You can share individual photos (or a selection of photos) with other users:

1. Select one or more photos from any view
2. Click the **three-dot menu** (⋮) → **"Share"**
3. Search for users and toggle sharing on or off for each

Shared photos appear in the recipient's **Sharing → Shared With Me → Photos** section, grouped by the person who shared them.

## Public Album Sharing via Link

You can create a public link for any user album, making it accessible to anyone — even people without an account on your LibrePhotos instance.

### Creating a Public Link

1. Navigate to the album you want to share publicly
2. Open the sharing dialog (three-dot menu → **"Sharing"**)
3. Toggle **"Public sharing"** on
4. A unique URL slug is generated automatically

The public album is accessible at `https://your-instance/public/s/{slug}`.

### Configuring Public Link Settings

When public sharing is enabled, you can configure:

#### Custom Slug
Change the URL slug to something memorable (3–64 characters). For example: `summer-vacation-2025` → `/public/s/summer-vacation-2025`.

#### Expiration
Set when the link should expire:
- **7 days**
- **30 days**
- **90 days**
- **Never** (no expiration)

After expiration, the link will no longer work.

#### Privacy Controls

Fine-tune what information visitors can see on the public album page:

| Setting | What it controls |
|---------|-----------------|
| **Show timestamps** | Whether photo dates and times are visible |
| **Show location** | Whether GPS coordinates and place names are shown |
| **Show camera info** | Whether camera model, lens, focal length, aperture, ISO, and shutter speed are shown |
| **Show captions** | Whether AI-generated or manual captions are visible |
| **Show faces** | Whether recognized people's names are displayed |

Each of these settings can be toggled independently per album. When set to `null` (default), the **user-level defaults** from your settings are used. You can configure your defaults in **Settings → Public Sharing Defaults**.

### The Public Album Experience

Visitors to a public album link see:

- A photo grid with the album's photos
- A lightbox viewer for browsing individual photos
- Photo details (subject to your privacy control settings)
- No login required

## Managing Your Shared Content

### Shared By Me

Navigate to **Sharing → By Me** to see:

- **Photos tab** — All photos you've shared, grouped by recipient
- **Albums tab** — All albums you've shared, grouped by recipient

### Shared With Me

Navigate to **Sharing → With Me** to see:

- **Photos tab** — Photos others have shared with you, grouped by sender
- **Albums tab** — Albums others have shared with you, grouped by sender

### Public Links

Navigate to **Sharing → Links** to see all albums you've made publicly accessible, with quick access to copy or manage each link.

## Public User Profiles

Users can make their profile publicly accessible by enabling **Public Sharing** in their profile settings. When enabled, other users on the instance can browse their public photos via the **Sharing → Public** page.
