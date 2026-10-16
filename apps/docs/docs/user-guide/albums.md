---
title: "📁 Albums"
description: "Managing your photo albums in LibrePhotos"
sidebar_position: 4
---

# Albums

LibrePhotos supports several types of albums to help you organize your photo library.

## Album Types

### User Albums (My Albums)
Albums you create manually to organize photos however you like. You can add any photos to these albums. To keep many of them in order, group them into [collections](#grouping-albums-into-collections).

### People Albums
Automatically generated albums based on face recognition. Each recognized person gets their own album.

The People page shows each person as a round picture of their cover face, the same face the Albums page shows; their name and number of faces sit under it. Choosing **Set as cover…** on a person's page also makes that person's face in the photo their cover face. A person whose face has no picture yet shows the whole cover photo instead, and a person without faces shows a placeholder. (Not released yet: up to 1.3.0, the People page showed the whole cover photo for everyone.)

A person's page has a **⋮** button (**Person actions**) at the right of its header:

- **Rename** renames the person. A name another person already has offers **Merge into** that person instead (see below).
- **Groups…** puts the person in your groups of people (see below).
- **Merge into…** merges this person into another one you pick from your people, then shows that person's page.
- **Manage faces** opens the face dashboard.
- **Delete person** removes the person from People and takes you back there. The photos stay in your library; the faces labelled with that person go back to the unknown faces, where you can label them again.

A photo that shows up under the wrong person can be taken off them from the person's page: select it (or several), open the selection's **⋮** menu and choose **Remove from this person** under **Album Actions**. After you confirm, the person's faces on those photos go back to the unknown faces of the [face dashboard](./face-recognition.md), and the photos leave the person's page; they stay in your library and in any albums. This works on photos you selected one by one, not after **Select all**. If you write face tags to your files, the files are updated too.

#### Groups of people

Groups gather people, for example "Family", "Work" or "Climbing club", so you can look at one circle at a time. A person can be in several groups, and only you see your groups.

- To put a person in groups, open the **⋮** on their tile on the People page (or on their page) and choose **Groups…**. Tick the groups they belong to; every tick is saved at once. Type a name under the list and click **Add** to make a new group with this person in it.
- To show only one group, use the group button in the People header (it says **All people** until you pick one). The list shows each group with how many people are in it. The page keeps the choice in its address, so **Back** from a person returns to the same group.
- **Manage groups…** at the bottom of that list renames and deletes groups and adds new ones. Deleting a group keeps its people.

When you merge two people, the person you merge into joins every group the merged person was in. The [face dashboard](./face-recognition.md#browse-people) has the same group button to label one group at a time.

*Not released yet: groups of people come with the release after 1.3.0.*

#### Merging two people

The same person can end up under two names: a typo, a nickname, or two face groups you labelled separately. Two people cannot share a name, so giving a person a name that someone else already has means they are the same person: the rename dialog (on the People page, the person's page or the face dashboard) shows **Merge into** followed by that name instead of **Rename**. On a person's page, **Merge into…** in the **⋮** menu does the same with a person you pick from a list.

Before anything changes you confirm the merge. Then:

- all faces of the merged person move to the person you merge into, including the faces LibrePhotos only suggests for them, so the photos show up on that person's page and in a search for their name;
- the merged person disappears from People;
- the person you merge into keeps their name and cover photo.

A merge cannot be undone. If you write face tags to your files, the files of the moved photos are updated in the background. The face classifier picks up the merged labels the next time you run [Train faces](./face-recognition.md#train-faces).

*Not released yet: up to 1.3.0, two people could not be merged, a person's page had no menu, a photo could only be taken off a person in the face dashboard, and a deleted or unknown person's page said "Loading" for good instead of "Person not found".*

### Events
Albums that group your photos into events based on when they were taken. Grouping is purely chronological: a photo joins the current event if it was taken less than **1 day and 12 hours** after the previous photo already in that event, so a continuous trip stays a single event however long it runs. An event needs at least two photos — a single photo on its own produces no album. Location and recognized people are not used for the grouping itself; they only feed the album's generated title (for example "Weekend in Paris") and its position on the map.

:::note
Unlike People, Places and Things albums, event albums are **not** created during a scan. To create them, open **Settings → Library**, find the **Event Albums** section and click **Generate** (or run the **Generate Event Albums** command from the search spotlight), and re-run it after importing new photos. **Regenerate Event Titles** only refreshes the titles of existing albums, which is useful once you have named faces or after reverse geocoding has filled in place names. It also cleans up titles made by 1.2.1 and older, which could read "with Unknown - Other" or contain a double space. See [Job System](./job-system.md) for the underlying jobs.
:::

Event titles follow the language you picked for the web app: "Wednesday Afternoon with Anna in Berlin" reads "Mittwochnachmittag mit Anna in Berlin" in German, once that language has the translation. Place and person names stay as they are. An event made before this change keeps its English title until the next **Generate Event Albums** run or a **Regenerate Event Titles**; the mobile app and search still use the English title.

*Not released yet: up to 1.3.0, event titles were always English.*

An event's cover on the **Events** page is its first photo until you pick another one with **Event actions** (⋮) → **Set as cover…** on the event's page (see [Setting an Album Cover](#setting-an-album-cover)). Running **Generate Event Albums** again keeps your pick: events are updated in place and only gain photos, and when new photos join two events into one, the merged event keeps the older event's cover, or the other one's if the older had none. **Delete all event albums** (Admin area, **Admin Tools**) removes the picks along with the events. A cover you hide or move to the trash later is replaced by the first photo again.

### Folders

The **Folders** page lists the folders of your scan directory. Each tile shows the newest photo in the folder or below it (by the date it was taken), with a small folder badge in its corner so that folders do not look like albums. Hidden photos, photos in the trash and other users' photos are never a folder's cover. The **All subfolders** list on a folder's page shows the same photo next to each folder.

<Since version="1.4.0" /> Up to 1.3.0, every folder showed the same folder icon.

### Places Albums
Automatically generated albums based on the GPS location data in your photos.

The **Places** card on the Albums page shows a small map zoomed to fit your places, or the whole world while you have none; click it to open the [Places page](./places.md#the-places-page). (Not released yet: up to 1.3.0, the card always showed the whole world.)

### Tags
Albums for **your own tags** — the labels you type yourself, as opposed to the things OpenCLIP detects. Every tag gets an album, and the **Tags** section of the Albums page lists them with a photo count. Tags also come in from your files: keywords stored in a photo's XMP `Subject` or IPTC `Keywords` (including `.xmp` sidecars, so tags applied in Lightroom or digiKam are picked up) become tags during a scan. See [Tagging photos](#tagging-photos) below for how to apply them, and [Search](./search.md) for finding photos by tag.

### Things Albums
Automatically generated albums based on detected objects and scenes in your photos. Things Albums are filtered by the currently active **Tagging Model** (configurable in Site Settings), so only things from the selected model are shown. Switching models does not delete your existing things, but it also does not detect things with the newly selected model — until things exist for that model, the Things section will look empty. To generate them, run a full **Rescan** from **Settings → Library** (in the *Scan Library* section, open the dropdown next to **Scan** and choose **Rescan**), which detects the things in your existing photos again. Albums created from `#hashtags` you typed into photo captions are always shown, regardless of the active model.

---

## Sorting album lists

**My Albums**, **Events**, **Things**, **Places**, **People**, **Tags** and **Folders** have a **Sort** button at the right of their header; on a phone it is an icon. It names the current order, for example **Sort: Name**. Click it and pick:

- under **Sort by**, what to sort on;
- under **Order**, which way round: **A to Z** or **Z to A** for names, **Most first** or **Fewest first** for numbers, **Newest first** or **Oldest first** for dates;
- **Reset to default**, to go back to the page's usual order. It only shows while you use another order, and so does the button's coloured background.

| Page | Usual order | Other orders |
| --- | --- | --- |
| My Albums | Name, A to Z | Number of photos; Date taken |
| Events | Date taken, newest first | Name; Number of photos |
| Things, Tags, Folders | Name, A to Z | Number of photos |
| Places | Size of place, largest first (countries first, then the places with the most photos) | Name; Number of photos |
| People | Name, A to Z | Number of faces |

**Date taken** on My Albums is when the album's oldest photo was taken, not when you made the album; photos in the trash or hidden do not count, and albums without a dated photo come last. People are sorted by their number of faces, the count under each name on the People page. Names sort the way people read them: "Album 2" comes before "Album 10", and upper and lower case do not matter.

Each page remembers its order in your browser, so going **Back** from an album returns to the same list at the same place. The order only changes what you see in the web app; the mobile app keeps its own.

*Not released yet: up to 1.3.0, the album lists could not be sorted.*

---

## Setting an Album Cover

You can customize the cover image for **People Albums**, **User Albums** and **Events**. There are two ways to do this:

### Method 1: Using the Cover Picker (Recommended)

1. Navigate to the album you want to customize (a person, a user album or an event)
2. Click the **three-dot menu** (⋮) at the right of the album's header (**Album actions**, **Person actions** on a person's page, **Event actions** on an event's page)
3. Click **"Set as cover…"**
4. A modal will open showing all photos in the album
5. Click on the photo you want to use as the cover
6. The cover is set immediately

On an event, the picker marks the cover in use and starts with **Automatic**, which goes back to the event's first photo.

:::tip
The cover picker loads photos in batches of 50 for better performance. Click "Load more photos" to see additional photos if your album is large.
:::

### Method 2: Quick Selection (Shortcut)

If you already know which photo you want to use:

1. Navigate to the album
2. **Select exactly one photo** — click **Select** at the right of the header and then the photo, or hover over it and click the checkbox that appears in its top-left corner (outside select mode, a plain click on a photo opens it in the lightbox instead of selecting it)
3. Click the **three-dot menu** (⋮) in the selection bar
4. Click **"Set album cover"**
5. The selected photo becomes the cover immediately

:::note
"Set as cover…" and "Set album cover" only appear on a People Album, a User Album or an Event. They won't be visible on other pages like the main timeline, Things or Places. Folder covers are always the newest photo.
:::

<Since version="1.4.0" /> Up to 1.3.0, an event's cover could not be changed.

*Not released yet: up to 1.3.0, the cover picker was "Set album cover" in the selection toolbar's ⋮ with nothing selected.*

---

## Creating User Albums

### An empty album

_Not released yet._ On **My Albums**, click **New album** (the **+** on a phone), give it a title that none of your albums has, and click **Create album**. The new album opens right away. It is empty, and shows a drop zone: drop photos and videos on it, or click **Upload photos**, to [upload them into the album](./upload.md#uploading-into-an-album). You can also fill it from your library as below.

If **My Albums** is showing one collection (see [Grouping albums into collections](#grouping-albums-into-collections)), the new album goes into that collection, and the dialog says so. Made from **All** or **Not in a collection**, it is in no collection and shows under **Not in a collection**.

Empty albums stay on **My Albums** with a *No cover* tile, also when you remove the last photo from an album. (Up to 1.3.0, an album without photos was hidden there.)

### From photos you select

1. Select one or more photos from any view: click **Select** at the right of the page header (an icon on a phone) and click the photos, or tick a photo's checkbox. The selection bar appears under the header while you select; its **✕** or the **Escape** key ends selecting and clears the selection
2. Click the **plus icon** (+) in the selection bar
3. Click **"Album"**
4. Either:
   - Enter a name for a new album and click "Create"
   - Or click on an existing album to add the photos to it

---

## Renaming and Deleting User Albums

On the **Albums** page, every User Album card has a **three-dot menu** (⋮) in its top-right corner. From it you can:

- **Rename** — enter a new title and confirm. Titles must be unique; the dialog blocks a name that another one of your albums already uses.
- **Sharing** — open the album sharing dialog (see the [Sharing guide](./sharing.md)).
- **Collections…** — put the album into collections (see [Grouping albums into collections](#grouping-albums-into-collections)).
- **Delete** — a confirmation dialog appears before the album is removed.

The album's own page has the same actions: the **⋮** button (**Album actions**) at the right of its header offers **Upload to this album…** (see [Uploading into an album](./upload.md#uploading-into-an-album); not released yet), **Rename**, **Sharing**, **Collections…**, **Lock album** or **Unlock album** (see [Locking user albums](#locking-user-albums-since-130)) and **Delete album**. A new title shows on the page right away, and after **Delete album** you land on **My Albums**. The menu is only there for your own albums; on an album someone shared with you it has **Leave album** instead (see [Leaving an album shared with you](./sharing.md#leaving-an-album-shared-with-you)).

*Not released yet: up to 1.3.0, an album could only be renamed, locked or deleted from its card.*

:::caution
Deleting an album is permanent and cannot be undone, but it only removes the album itself. The photos it contained stay in your library.
:::

---

## Grouping albums into collections

A collection is a label for albums, such as "Travel", "Family" or "2000s". An album can be in any number of collections, so a family trip from 2004 can be in "Travel", "Family" and "2000s" at once. Collections only group albums: an album stays an album, and deleting a collection never deletes its albums or photos.

### Filtering My Albums

Once you have a collection, **My Albums** shows a row of chips under its header: **All**, one chip per collection with the number of albums in it, and **Not in a collection**. Click a chip to show only those albums; the header then says how many albums are in it. The chosen collection stays in the page address, so going **Back** from an album returns to the same filtered list.

### Putting an album into collections

1. Open the album card's **⋮** menu on **My Albums**, or the **⋮** (**Album actions**) at the right of the album's own header.
2. Choose **Collections…**.
3. Tick the collections the album belongs in, and untick the ones it does not. Each tick is saved right away.
4. To make a new collection, type its name in **New collection** and click **Add**: it is created and the album is put in it.
5. Click **Done**.

### Renaming and deleting collections

Open the **⋮** at the end of the chip row and choose **Manage collections…** (while you have no collection yet, click **New collection** on **My Albums** instead). The dialog lists your collections with their album counts:

- the pencil button renames a collection;
- the bin button deletes it, after you confirm. Its albums stay in **My Albums**;
- **New collection** at the bottom adds one.

Collection names are unique per user, ignoring upper and lower case: you cannot have both "Travel" and "travel".

:::note
Collections are private. When you share an album, the people you share it with see the album but not your collections, and they cannot put your album into collections of their own.
:::

*Not released yet: up to 1.3.0, albums could not be grouped.*

---

## Sharing Albums

User Albums can be shared with other users on your LibrePhotos instance, or publicly via a link. For full details on all sharing features, see the [Sharing guide](./sharing.md).

1. Navigate to the User Album you want to share
2. Click the **three-dot menu** (⋮) at the right of the album's header and choose **Sharing** (or, while selecting photos, in the selection bar's ⋮, **Sharing** under "Album Actions")
3. Search for and select the users you want to share with

---

## Public Sharing via Link

You can share albums publicly with anyone via a unique link, without requiring them to have an account on your LibrePhotos instance:

1. Navigate to the User Album you want to share publicly
2. Click the **three-dot menu** (⋮) at the right of the album's header and choose **"Sharing"**
3. In the dialog, toggle **"Public sharing"** on — a unique URL slug is generated automatically that you can share with anyone
4. Click **"Show settings"** to customize the slug (3–64 characters), set an expiration (7, 30 or 90 days, or never), and control what information visitors can see:
   - Location data
   - Camera information
   - Timestamps
   - Captions
   - Recognized faces

Turning **"Public sharing"** off asks first, because it revokes the link for good: the old address never works again, and turning sharing back on creates a new one. Anyone you gave the old link to needs the new one.

Once an album is public, it appears under **Sharing → Links**, where you can copy the link, open it, or reopen the sharing dialog to change its settings. Albums that are not yet public are not listed there.

Default privacy settings for new public links can be configured in **Settings → Public Sharing Defaults**.

Public albums are accessible at `/public/s/{slug}` and include a lightbox viewer with the same navigation experience as the main app.

---

## Tagging photos

Tags are yours to type: a place name, a project, "to print", whatever you sort by. A photo can carry any number of them.

### Tagging a selection

Anywhere you can select photos — the timeline, a search result, a person, place, thing or user album, or a folder — you can tag the whole selection at once:

1. Select the photos and videos you want to tag.
2. Press **`t`**, or open the **plus menu** (＋) and click **Tags**.
3. Type the tags, separating several with a comma. Suggestions narrow as you type — tags that *begin* with what you typed come first, so a letter or two is usually enough — and anything new is created for you.
4. Click **Add tags** (or press Enter on an empty box).

Every tag in the box is applied to every photo in the selection. Tagging is additive — it never removes a tag a photo already has.

**Select all** works too: with the whole view selected, the tags apply to everything the current view holds, whatever its filters (including the Photos / Videos selector), minus any photo you unchecked. That is one request for the whole library rather than one per photo, so it stays quick on a large one.

:::note
`t` is used instead of Ctrl+T because browsers reserve Ctrl+T for opening a new tab and a web page cannot intercept it.
:::

### Tagging one photo

Open a photo and use the **Tags** section of the [sidebar](./viewing-photos.md) — the pencil button opens the same comma-separated editor, and here it both adds and removes: whatever you leave in the box is what the photo ends up with. Click a tag badge to jump to that tag's album. A tag that came from the file's keywords carries a small file icon there; see [Tags](./viewing-photos.md#tags).

### Renaming, merging and deleting tags

On the Albums page, open **Tags → View all**. The three-dot menu on any tag offers:

- **Rename** — the tag keeps its photos.
- **Merge** — pick another tag to fold into this one; its photos move over and it is deleted.
- **Delete** — removes the tag. Your photos are untouched.

With [Write edits to files](./settings/index.md#metadata-options) on, tags are written to the files as keywords, so a rename, merge or delete also changes the keyword in the files of every photo carrying the tag, in the background. Tagging a selection or one photo writes the same way. _Not released yet._

:::note
Tags are per user: two accounts can each have a tag called `holiday` without seeing each other's.
:::

A tag outlives its photos. Trashing, hiding or deleting the last photo that carried a tag leaves the tag in place: it stays in the Tags list with a placeholder tile so you can still rename or delete it, and its own page tells you it is empty. That is deliberate — you may well want to create a tag before anything carries it, and deleting photos should never silently delete tags.

:::caution
A tag you add in LibrePhotos is not written back into the image file yet. A tag that *came* from a file's keywords stays in that file, but new tags live only in LibrePhotos' database.
:::

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

## Locking user albums {#locking-user-albums-since-130}

<Since version="1.3.0" />

In the user album list, open an album’s three-dot menu and choose **Lock album**; on the album's own page, the same item is in the **⋮** at the right of its header. A lock icon marks locked albums in the list, and a grey **Locked** badge follows the title on the album's page. Choose **Unlock album** from the same menus to allow changes again.

Locking prevents adding photos to the album or removing photos from it. Locked albums are disabled in the add-to-album picker, and **Remove Photos** is disabled in a locked album’s selection menu, saying that the album is locked and has to be unlocked first. The lock protects which photos are in the album, not the photos themselves: you can still favorite, hide, share, tag or delete them, rename the album, change its cover, and manage album sharing.

The API enforces the album membership lock. This does not protect the underlying photos from changes made elsewhere in your library or prevent deleting the album itself.
