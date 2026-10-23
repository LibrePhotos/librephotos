---
title: "🔗 Sharing"
description: "Share photos and albums with other users or publicly via links"
sidebar_position: 6
---

LibrePhotos offers multiple ways to share your photos and albums — with other users on your instance, or publicly with anyone via a link.

## The Sharing Page

The **Sharing** page (accessible from the navigation) is your central hub for all sharing activity. It provides an overview of:

- **Your library**: who you share your whole library with, and what each of them sees ([Sharing your whole library](#sharing-your-whole-library))
- **Libraries shared with you**: the libraries other users share with you. This row only shows once someone does.
- **Public photos** — Other users on your instance who have made their profile public
- **Shared with you** — Photos and albums that others have shared with you
- **You shared** — Photos and albums you have shared with others
- **Public Links** — Albums and photos you've shared publicly via link. An album card shows the album's title and number of photos; a photo card says **Share link** and when you made the link, or **Public photo** and the day the photo was taken. <Since version="1.4.0" /> Up to 1.3.0, photo cards had no caption.

## Sharing Albums with Users

You can share any user album with other users on your LibrePhotos instance:

1. Navigate to the album you want to share
2. Open the **⋮** (**Album actions**) at the right of the album's header and choose **Sharing**
3. Search for users and pick a role for each: **No access**, **Can view** or **Can add photos**

You can also open the same dialog from the share action on the album's card under **Albums**, or, while selecting photos, from the selection bar's **three-dot menu** (⋮) under **Album Actions**.

Shared albums show up in the recipient's sharing area: they open **Sharing**, click the **Shared with you** tile, then the **Albums** tab (the page is titled *Albums others shared*).

<Since version="1.5.0" /> Up to 1.4.0, each user had an on/off switch instead of a role, and everyone you shared an album with could only view it.

## Albums others can add to

<Since version="1.5.0" />

A user you give **Can add photos** becomes a contributor: they add photos from their own library to your album, for example when you both photograph the dog. Their photos stay theirs. The album only links them, so nothing is copied or moved, and taking a photo out of the album never deletes it.

**Adding photos.** A contributor selects photos anywhere in their library, opens the **+** menu and chooses **Album**. Under **Shared with you, you can add** they pick your album. The next step says who will see the photos and what of them (see below), and **Add to** adds them. Hidden photos cannot be added, and nobody adds photos while the album is [locked](./albums.md).

**What each person can do**

| | Owner | Can add photos | Can view |
|---|---|---|---|
| See the album and its photos | ✓ | ✓ | ✓ |
| Add their own photos | ✓ | ✓ | |
| Take photos out of the album | any photo | only the photos they added | |
| Rename, set the cover, lock, delete the album | ✓ | | |
| Share it with others, change roles, public link | ✓ | | |

On the album page a contributor clicks **Select**, selects the photos they added and chooses **Remove from album**. A photo someone else added says why it cannot be removed.

**Leaving and roles.** When a contributor leaves the album, or you set them to **Can view** or **No access**, the photos they added leave the album at once. They stay in their library. The share dialog asks first and says how many photos leave.

### What members see of each photo

Members always see the photos and their dates. Each of these details shows only where **both** sides allow it:

- **Location**, **Names of people**, **Camera information**, **Captions** and **Original files**.
- The album's owner sets what members may see under **What members see** in the share dialog. All are on by default, so your own photos look to members as they did before.
- A contributor sets what the others see of the photos they add: in the step before adding, or later with **What others see of my photos** in the album's **⋮**. All are off until they turn them on. The table shows the album's choice, theirs and the result.
- Names of people on the owner's photos also need [Show the names of people on photos you share](#what-the-users-you-share-with-see).

Some things are never shared through an album: the file name and folder, ratings and favourites, whether the photo is hidden or in the trash, the photo's other albums and its edit history. A photo its owner hides or moves to the trash disappears from the album for everyone else.

Without **Original files**, a member who downloads a photo, or plays a video, gets a full-size copy without the file's metadata instead of the original, as with a [shared library](#sharing-your-whole-library): the original carries everything the camera recorded, including where it was taken.

The same choices hold under **Shared with you**: the album's photos appear under its members' places only with **Location** on, under their things only with **Captions** on and under their people only with **Names of people** on, and each photo there shows only what the album allows. A photo the owner also shared with you on its own shows what that share shows.

When the photo's owner also shares their whole library with you, that share's choices decide what you see of their photos, in albums too.

### Comments and likes

<Since version="1.5.0" />

Everyone in a shared album, its owner included, can comment on its photos and like them. Open a photo from the album's page and open the details panel (**Toggle info panel**): under **Comments** you see the comments, the heart and who liked the photo, and a box to write in. **Enter** sends, **Shift+Enter** starts a new line.

- Comments belong to the album, not the photo: the same photo in another album has its own comments, and only the people in that album see them.
- A comment is plain text, at most 1000 characters. Links and formatting are shown as typed.
- You edit and delete your own comments from their **⋮**. The album's owner can delete anyone's comment, and turn comments and likes off with **Members can comment and like** in the album's **Sharing** dialog. While they are off, the existing comments stay visible and nobody can add one.
- When a photo leaves the album, or a contributor leaves and takes their photos with them, the comments and likes on those photos are deleted.
- To keep one person from flooding an album, each user can post at most 30 comments or likes a minute.

### Where a contributor's photos show

Only in the album itself. They are not in the album owner's timeline, search, places or downloads, not in anyone's **Shared with you** places, things and people, and never on the album's **public link**, which shows only the owner's own photos.

An album only holds photos its owner or a current contributor added. Since 1.5.0, old links in an album to other users' photos are removed when you upgrade.

## Sharing a person

<Since version="1.5.0" />

You can share one of your people, for example your child with the grandparents, without sharing an album or your whole library. Open the person under **People**, open the **⋮** (**Person actions**) and choose **Share…**. Turn on each user who should see the photos; they can only look.

Face recognition can be wrong, and a wrong match would hand someone a photo that has nothing to do with the person. So the people you share with see a photo only when **both** of these are true:

- **You labelled a face on it** with the person. A face that face recognition only suggested, or a face group such as *Unknown 012*, never counts. Only people you named can be shared.
- **You approved it for sharing.** The photos you labelled before you first share the person are approved at once: that is what you chose to share. Photos you label afterwards wait, also when you turn a user off and on again. The person's page then says how many wait; **Review** shows them, each ticked, and the ticked ones are shared when you confirm. An unticked photo is kept back for good.

Taking the label off, hiding or trashing a photo takes it away from them at once, and turning a user off in **Share…** ends their access to all of the person's photos.

They see each photo and its date. Two switches in **Share…** add more, both off by default: **Where the photos were taken** and **Names of the other people on these photos**. Camera details, captions and original files are never shared this way (a download is a copy without the file's metadata).

The people you share with find the person under **Shared with you**, on the **People** tab, with whose person it is (*Mila, shared by Anna*).

## Sharing Photos with Users

You can share individual photos (or a selection of photos) with other users:

1. Select one or more photos from any view
2. Click the **three-dot menu** (⋮) and, under **Photo Actions**, choose **"Sharing"**
3. Search for users and toggle sharing on or off for each

Shared photos show up in the recipient's sharing area, grouped by the person who shared them: they open **Sharing**, click the **Shared with you** tile, then the **Photos** tab (the page is titled *Photos others shared*).

## Sharing your whole library

<Since version="1.5.0" />

You can share your whole library with another user, read-only. They see your photos and videos as you add them, without you sharing albums or photos one by one. Nothing moves and nothing is copied: the photos, their people, albums and edits stay yours, and you can stop at any time.

### Starting a share

1. Open **Sharing**. The **Your library** section is at the top.
2. Click **Share my library**.
3. Under **With**, pick the user.
4. Under **What they see**, turn on what you want them to see. Every switch starts off.
5. Click **Share with Ben** (with their name).

### What they see

| | They see it |
|---|---|
| Photos and videos, and their dates | Always |
| **Location**: GPS position, place names, the map and Places | Only with the switch on |
| **People names**: the face boxes and names of the people you named | Only with the switch on. Faces you have not named and face groups such as *Unknown 012* are never shown |
| **Camera information**: make, model, lens and exposure | Only with the switch on |
| **Captions and descriptions**: your descriptions, generated captions and text found in photos | Only with the switch on. A generated caption can name the person and the place, so it also needs **Location** and **People names** |
| **Download original files** | Only with the switch on. Off, a download is a full-size copy without the file's metadata |
| <Since version="1.5.0" /> The photo's [copyright, creator and license](./rights.md) | Always |
| Hidden photos, the trash, albums, tags, favourites and ratings, edit history, file names and folders | Never |

:::caution
An original file keeps its GPS position, camera serial number and keywords inside it, whatever the **Location** switch says. Turn on **Download original files** only for someone you would also show where your photos were taken. With it off, downloads and videos are copies without that metadata; thumbnails never carry it.
:::

**Search follows the same rules.** With **Location** off, searching a place name does not find your photos for them; with **People names** off, searching a person's name does not either, and the same goes for captions and cameras. Searching for what is in a photo, such as *beach* or *dog*, works, because they see the photo.

They can open, search and download your photos. They cannot edit, delete, favourite, rate or hide them, add them to their albums, or change their people.

The switches also apply to the photos and albums you share with that user one by one: once you share your library with someone, its switches decide what they see of every photo of yours.

### Changing or stopping a share

Every person you share your library with is listed under **Your library**, with a line that says what they see (for example *No location*, *People*, *Copies only*) and whether they show your photos in their timeline. Click **What Ben sees** (with their name) to:

- turn a switch on or off. It is saved at once.
- **Preview a photo as Ben**: your newest photo, with what you see next to what they see.
- **Stop sharing**. They lose access at once, including photo links they already opened. Photos and albums you shared with them one by one stay shared.

### A library shared with you

When someone shares their library with you, **Sharing** shows it under **Libraries shared with you**. Click it to open the library, read-only, as a timeline of its days. The page says what the owner shares; a day shows no place when they do not share locations.

Turn on **Show in my timeline** to see their photos between yours on the **Photos** page, in your search and in their day groups. Their photos carry a small avatar in the corner, and the title says whose photos it includes. It is off when a share starts, and only you can turn it on or off. Archived photos stay out of your timeline, as in theirs, but are in their library page.

The details panel of their photo says whose photo it is and, for each field they do not share, that they don't share it with you. The photo's own controls are not there: it is read-only.

To leave a library, open it, click the **⋮** at the right of its title and choose **Leave Anna's library** (with the owner's name). LibrePhotos asks first. The owner can share it with you again.

## What the users you share with see

<Since version="1.5.0" />

When you share an album or a photo with another user, they see each shared photo with its date, its place and its things (what the photo shows, such as *beach* or *tram*). They find the shared photos under the places and things in their [Shared with you](#shared-with-me) area, counted from the photos you shared with them only: your other photos of the same place never show, not even in a count.

The people on a photo are different, because a name is personal. The users you share with see people only if you allow it:

- Open **Settings** and, under **Sharing with users**, turn on **Show the names of people on photos you share**. It is off by default.
- Even then, they only see the people you named. Faces you have not named, face groups such as *Unknown 012* and the suggestions face recognition makes are never shown to them.
- The setting applies to everything you share with other users, albums and single photos alike.

The sharing dialogs say the same in one sentence under the list of users.

When you also [share your whole library](#sharing-your-whole-library) with someone, its **People names** switch decides for them instead of this setting.

Public links do not use this setting: what a visitor of a public album or photo link sees is set by the [Photo Details](#photo-details) of the link, and **Share detected faces** there also shows only the people you named.

## Public Album Sharing via Link

You can create a public link for any user album, making it accessible to anyone — even people without an account on your LibrePhotos instance.

### Creating a Public Link

1. Navigate to the album you want to share publicly
2. Open the sharing dialog (three-dot menu → **"Sharing"**)
3. Toggle **"Public sharing"** on
4. A unique URL slug is generated automatically

The public album is accessible at `https://your-instance/public/s/{slug}`.

On your public profile, `https://your-instance/public/<username>?album={slug}` shows the same album. A link always needs the slug: the album's number alone opens nothing for a visitor.

The dialog shows it as the **Album link**, with buttons to copy it and to open it in a new tab.

### Slideshow Link

Under the album link, the dialog also shows a **Slideshow link**: the same address with `?slideshow=1` added (`https://your-instance/public/s/{slug}?slideshow=1`), with its own copy and open buttons. Whoever opens it sees the album start as a slideshow from its first photo, in the [lightbox](./viewing-photos.md), instead of the photo grid. It is handy for a photo frame, a TV or a party screen.

- The slideshow link is the album link with a different start: it shows the same photos and the same Photo Details, expires with the album link, and stops working when you turn public sharing off. There is no separate link to revoke.
- Visitors have no LibrePhotos settings, so a photo stays on screen for 5 seconds. They can change the interval in the lightbox, pause with the play button or `s`, and step through with the arrow keys.
- The slideshow stops at the last photo. Closing the lightbox shows the album's photo grid, and the address goes back to the plain album link.
- When the visitor's device asks for reduced motion, photos cross-fade instead of zooming in.

Only whole albums can be shared as a slideshow: there is no slideshow link for a hand-picked selection of photos. Put the photos in an album and share that.

<Since version="1.4.0" /> Up to 1.3.0, a public album link always opened on the photo grid.

### Revoking a Public Link

Toggle **"Public sharing"** off again and the link stops working immediately. The slug is burned at the same time, so turning public sharing back on generates a brand-new URL rather than reviving the old one. Anyone who still holds the withdrawn link, including someone you shared it with by mistake, keeps getting a "not found" page.

This also means a custom slug is not kept across a revoke: set it again after re-enabling the link if you want it back.

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
| **Share photo timestamps** | Whether photo dates and times are visible. Without it, photos are not grouped by day and are listed in an order that says nothing about when they were taken. |
| **Share location information** | Whether GPS coordinates and place names are shown |
| **Share camera information** | Whether camera model, lens, focal length, aperture, ISO, and shutter speed are shown |
| **Share captions** | Whether captions are visible: yours, and the tags. A caption written by the captioning model can name the person and the place (see [Caption Context](./settings/index.md#caption-context)), so it is shown only when location information and detected faces are shared too. |
| **Share detected faces** | Whether the names of the people you named are displayed. Faces you have not named and face groups are never shown. |

<Since version="1.5.0" /> A photo's [copyright, creator and license](./rights.md#on-public-pages) follow none of these settings: they are shown on every public page, so visitors know what they may do with the photo.

Each of these settings can be toggled independently per album. When left unset, the **user-level defaults** from your settings are used; you can configure those in **Settings → Public Sharing Defaults**.

**All five are off by default** — both as the built-in fallback and as the initial value of your user-level defaults, following a privacy-first, opt-in approach. So on a brand-new public link, visitors don't see any of these per-photo details until you turn the relevant options on.

These settings cover what the page shows, and the files behind it. Thumbnails are stored without the photo's EXIF and XMP (GPS position, camera serial number, keywords), keeping only the colour profile. Thumbnails created by 1.2.1 and older may still contain it. An admin cleans them once after upgrading, with **Remove photo details from old thumbnails** in **Admin Area > Admin Tools** or the `strip_thumbnail_metadata` command; see [After upgrading from 1.2.1 or older](../installation/upgrading.md#strip-thumbnail-metadata).

An original file carries all of its metadata at once (location, camera, date, keywords, people), so a visitor gets the original file of a photo or video only when **all five** settings are on. Otherwise a download is a full-size copy without metadata (a photo as a JPEG keeping only its colour profile, a video with its streams as they are but without the recorded location and other container metadata), and the video of a motion photo is not available. The text LibrePhotos searches in, file names and folders, ratings, favourites and stacks are never shown to visitors, whatever the settings.

The same rules apply wherever a visitor can reach the photo: the public album page, a [photo made public](#making-individual-photos-public), your public profile, and a [photo link](#revocable-photo-links). Users of your instance who open a public photo that is not shared with them see it as a visitor does.

:::caution
Changes to the slug, expiration and Photo Details settings are **not applied until you click "Save link settings"** at the bottom of the settings panel. That button stays disabled until you change something; the **Public sharing** toggle itself only saves the on/off state.
:::

### The Public Album Experience

Visitors to a public album link see:

- A photo grid with the album's photos
- A **Play slideshow** button above the grid (a play icon on a phone), which starts the same slideshow as the [slideshow link](#slideshow-link)
- A lightbox viewer for browsing individual photos; the open photo is in the address, so a visitor can [link to one photo of the album](./viewing-photos.md#photo-link)
- Photo details (subject to the album's Photo Details settings)
- No login required

## Making Individual Photos Public

Besides sharing whole albums, you can make individual photos public without putting them in an album:

1. Select one or more photos from any view
2. Click the **three-dot menu** (⋮) and, under **Photo Actions**, choose **"Make Public"**

When you select photos individually, direct image links (`https://your-instance/media/photos/<hash>.jpg`) are copied to your clipboard so you can paste them straight away. In *select all* mode the photos are still made public, but no links are copied.

These are raw image-file URLs, so they behave differently from public album links. There is no album page, no custom slug and no expiration — anyone with the link can open the image file directly. What it shows follows your **Settings → Public Sharing Defaults**: the original file only when all five details are shared, otherwise a copy without its metadata (see [Photo Details](#photo-details)). If you need per-link controls, share a public album instead.

Public photos appear under the **Photos** tab of your **Public Links** page, on your public profile at `https://your-instance/public/<username>`, and in your own [My Public Photos](./viewing-photos.md#my-public-photos) view. Your public profile shows the details your Public Sharing Defaults allow; without **Share photo timestamps** its photos are one group without a date instead of days.

To reverse this, select the photos again and choose **"Make Private"** from the same menu.

### Revocable Photo Links

The **globe button** in the lightbox (shortcut **P**) does something different from the bulk *Make Public* action above: it creates a *share link* for that one photo and opens a dialog showing it, with a button to copy it. The link looks like `https://your-instance/public/p/{slug}`, where the slug is 12 random characters that belong to the share rather than to the photo. Creating a link does **not** make the photo public: it does not appear on your public profile or under *Make Public*, and the photo's own `/media/...` URLs still require a login.

Because the slug is random, the link can be withdrawn:

- **Replace link** mints a new slug. The previous URL, and the image and video URLs behind it, stop working at once.
- **Revoke** switches the share off and burns the slug, so anyone still holding that link gets a "not found" page. Sharing the photo again creates a brand-new link rather than reviving the old one.

Your active photo links are listed under the **Photos** tab of your **Public Links** page, each with its own copy, replace and revoke buttons.

What a visitor with the link can see:

- The photo as a large preview image (not the original file). For a video, the video itself, so it can be played: the original file only when all five Public Sharing Defaults are on, otherwise a copy without its metadata.
- The photo details you allow in **Settings → Public Sharing Defaults** (date, location, camera, captions, people's names). Photo links have no per-link settings of their own.

What they cannot see: the original file of a photo, face thumbnails, any other photo, or anything that identifies the file's content hash. While the photo is hidden or in the trash, its link shows "not found" as well.

Expiring links and password-protected links are not available for photo shares yet.

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
- **Places tab**: the places of the photos shared with you, directly or in an album. A place several people shared photos of is one tile, so *Lisbon* holds everyone's Lisbon photos. Its count only covers the photos shared with you.
- **Things tab**: the things the shared photos show, the same way.
- **People tab**: the people their owners named on the photos shared with you, each with whose person it is (*Mom, shared by Alice*). Two people's *Mom* stay two tiles. You only see someone's people if they [allow it](#what-the-users-you-share-with-see).

Click a place, thing or person to see the photos shared with you under it, grouped by sender. When nothing is shared with you under it any more, the page says so.

In the details panel of a photo someone shared with you directly, you see its people (if the owner shares their names), its things and who shared it. You cannot change them; that is for the owner.

<Since version="1.5.0" /> Up to 1.4.0, there were no Places, Things and People tabs, and the details panel of a photo shared with you showed only its date and place.

### Leaving an album shared with you

An album someone shared with you stays in your list until you leave it. Open the **⋮** on the album's cover under **Albums others shared**, or the **⋮** (**Album actions**) at the right of the album page's header, and choose **Leave album**. LibrePhotos asks first; after you confirm, the album and its photos are no longer shown to you under Sharing, and on the mobile app it disappears at the next sync.

Only you leave: the owner keeps the album, it stays shared with everyone else, and the owner no longer sees you under **Albums you shared** for it. They can share it with you again at any time. You cannot leave an album you own; delete it or stop sharing it instead.

<Since version="1.5.0" /> If you could add photos, the photos you added leave the album with you. They stay in your library.

<Since version="1.4.0" /> Up to 1.3.0, only the owner could take an album off your list, by unsharing it.

### Public Links

Open **Sharing** and click the **Public Links** tile to see everything you've made publicly accessible. It has two tabs: **Albums** (albums with a public link) and **Photos** (individual photos you've marked public).

The **Public Links** row on the Sharing page shows your latest public photos and counts all of them.

<Since version="1.4.0" /> Up to 1.3.0, public photos rarely showed or counted on the Sharing page or the Photos tab, and the Photos tab also listed other users' public photos.

## Public User Profiles

Users can make their profile publicly accessible by enabling **Public Sharing** in their profile settings. Other users on the instance can then find them in the **Public photos** section of the **Sharing** page, which lists every user with public sharing enabled along with their public photo count. A user's public photos are browsable at `https://your-instance/public/<username>`.

## Sharing photos in a family

LibrePhotos has no shared library yet, where several people own the same photos together ([#395](https://github.com/LibrePhotos/librephotos/issues/395)). Every photo belongs to exactly one user, with its own faces, albums, ratings and edits. That is why two users cannot scan the same folder: LibrePhotos refuses a scan directory that overlaps another user's (see [Manage multiple users](./managing-users.md)). A household can still share its photos today, in one of these setups.

### Setup 1: a family account

Create one account for the shared family archive and give it the family folder as its scan directory. Everyone also gets a personal account for their own photos.

- The family account names the people, makes albums and shares them with each person's account.
- Everyone sees the family photos under **Shared with you**, with their places, things and, if the family account [shares names](#what-the-users-you-share-with-see), their people.
- Only the family account can edit the family photos, name people or change albums. Someone has to sign in as it to do that.

### Setup 2: everyone shares their own photos

Each person scans their own folder and shares albums or single photos with the others.

- Each person keeps their own favourites, faces and private photos.
- Under **Shared with you**, everyone sees the others' places and things merged, and their people per owner.
- A trip both partners photographed stays in two libraries. One makes an album and gives the other **Can add photos**, so both halves end up in [one album](#albums-others-can-add-to).

### Setup 3: share your libraries with each other

<Since version="1.5.0" />

Each person scans their own folder and [shares their whole library](#sharing-your-whole-library) with the others, choosing what they see. Everyone turns on **Show in my timeline** for the libraries they want between their own photos.

- Each person keeps their own favourites, faces, albums and hidden photos.
- New photos show up for the others without sharing anything again.
- The others can look, search and download, but not edit: for photos several people should change, use Setup 1.

### Setup 4: one shared login

Everyone signs in with the same account. It is the simplest setup, but nobody has favourites, ratings or private photos of their own, and everyone sees everything, including what someone meant to keep to themselves.

### Setup 5: share the people who matter

Each person keeps their own library and shares the people the others care about, for example the children with both grandparents ([Sharing a person](#sharing-a-person)). New photos of them reach the others once you approve them.

### What is not possible yet

- Owning photos together, or one library that several users scan and change: [#395](https://github.com/LibrePhotos/librephotos/issues/395). [Sharing your whole library](#sharing-your-whole-library) shares it read-only.
- Adding the people someone shared with you to your own People page: [#632](https://github.com/LibrePhotos/librephotos/issues/632).
