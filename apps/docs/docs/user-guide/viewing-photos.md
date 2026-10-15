---
title: "🖼️ Viewing Photos"
description: "Photo views, the lightbox, the photo details sidebar and the photo page"
sidebar_position: 2
---

## Photo Views

LibrePhotos provides several ways to browse your photo library. You can switch between views using the navigation menu or the header dropdown on the main timeline.

### Timeline (Home)

The default view showing all your photos grouped by date, from newest to oldest. A **scroll scrubber** on the right edge lets you quickly jump to any date — click or drag it to navigate through large libraries.

#### Filtering the timeline

<Since version="1.3.0" />

The **Filter** button next to the display options narrows what the timeline shows:

- **Media type**: all, photos only, or videos only.
- **Hide from timeline**: leave out **Screenshots** and/or **Documents** (see [Fixing a wrong category](#category)).
- **Show only**: **Favorites**.

While a filter is active the button is highlighted with the number of active filters, and the header says what is filtered. The filter lives in the page address, so it survives a reload and can be bookmarked.

**Save as default** makes the current filter what the timeline shows every time you open it, for example to keep screenshots out for good. **Reset to default** goes back to your saved default. A saved default applies to the main timeline only: Favorites, Screenshots, Videos, Hidden, Trash, albums, folders, search, people, places and public pages are never filtered by it.

Selecting all photos on a filtered timeline selects only what it shows, so **Select all** followed by **Move to trash** never reaches the screenshots or documents the filter hides.

### Favorites

Photos you've marked as favorites. To favorite a photo, click the star icon in the lightbox toolbar (or press `f`), or use the selection actions menu. The star turns yellow once the photo's rating reaches the **Minimum image rating to interpret as favorite** value in your user settings.

Removing a favorite sets the photo's rating to 0, which also clears a star rating it had (for example a 5-star rating imported from Lightroom or digiKam). If you rate with stars, switch to stars mode instead.

#### Rating photos with stars

Not released yet. Set **Rating style** to **Stars** in [Settings](./settings/index.md#metadata-options) to rate photos from 1 to 5 stars instead of marking favorites:

- In the photo viewer, five stars replace the favorite star in the toolbar, and on the [photo page](#photo-page) a **Rating** tile replaces **Favorite**. Click a star to set the rating, click the current rating again to clear it, or press `1` to `5` (`0` clears it). On a photo someone shared with you, the stars show the owner's rating and cannot be changed.
- In the grid, a rated photo shows its rating, such as **4 ★**, in the top-right corner. Unrated photos show nothing.
- To rate several photos, select them and choose **Set rating** from the selection actions menu. **Set rating** is not available after **Select all**: select the photos one by one instead.

The rating is the same 0-5 rating that is read from and written to the file's metadata, so it matches what the mobile app and other photo tools show. Photos at or above **Minimum image rating to interpret as favorite** still appear on the Favorites page.

### Hidden

Photos you've hidden. Hiding a photo takes it out of every view (the timeline, albums, people, places, search and folders) without deleting it; this page is the only place it still shows. To hide photos, select them and choose **"Hide"** from the selection actions menu. To keep a photo in your albums but off the timeline, archive it instead (see [Hidden or archived?](#hidden-or-archived)).

### Archive {#archive}

Photos you've archived. Archiving takes a photo off the main timeline and out of [Memories](./memories.md), and nothing else: it stays in its albums, on the people and places pages, in folders and in search. Use it for photos you have sorted into albums and no longer want to scroll past, or for receipts and other photos you want to keep but not see every day.

- To archive photos, select them and choose **Archive** from the selection actions menu (the ⋮ button). **Unarchive** in the same menu puts them back on the timeline. Both work after **Select all** too.
- In the photo viewer, the archive button next to the eye (or the `a` key) archives the photo you are looking at, or unarchives it. On the [photo page](#photo-page) it is under **More**.
- Open the Archive page from the Photos header dropdown (after **Hidden**) or by searching for "Archive" with `Ctrl` + `k`. It has the same [media filter](#media-filter) as the Hidden page.
- In albums, search and the other views, an archived photo has a small archive mark in its top right corner, so you can see why it is not on your timeline.

*Not released yet: Archive ships with the first release after 1.3.0.*

#### Hidden or archived? {#hidden-or-archived}

| Where the photo shows | Archived | Hidden |
| --- | --- | --- |
| Timeline (Photos) | No | No |
| Memories | No | No |
| Albums, events | Yes | No |
| People, places, things, tags | Yes | No |
| Search | Yes | No |
| Folders | Yes | No |
| Favorites, Videos, Screenshots and the other views in the Photos dropdown | Yes | No |
| Its own page | Archive | Hidden |

A photo can be hidden and archived at the same time; then it is hidden, and shows only on the Hidden page until you unhide it. Neither one deletes the photo or changes its file.

### Recently Added

Shows only your most recent batch of imports — the photos whose *added* date falls on the same calendar day as the most recently added photo in your library. They appear in a single flat grid under one **"Added on …"** line in the page header; there is no per-day grouping. Older imports are not listed here — use the Timeline to browse your whole library. With a [media filter](#media-filter), the page shows the latest day a matching photo was added, for example the last day you imported videos.

### Photos Only

Shows only still photos, filtering out all videos.

### Videos Only

Shows only video files, filtering out all still photos.

### Screenshots and Documents

**Screenshots** lists the photos detected or marked as screenshots. **Documents** lists the photos of receipts, letters, forms and other paper (see [Documents](./text-recognition.md#documents)). Both are in the Photos view switcher in the page header and in the command palette (`Ctrl+K`). When a photo is in the wrong one, change its [Category](#category).

:::note
<Since version="1.4.0" /> This applies to the Documents page.
:::

### Filtering a list by media type {#media-filter}

:::note
<Since version="1.4.0" /> This applies to the labelled media button, its **Documents only** choice, and the filter on Trash, Recently Added, Without Timestamp, Without Location and folder pages.
:::

Favorites, Hidden, Trash, Recently Added, Without Timestamp, Without Location, Not in an Album, search results, and the album, person, place, thing, tag and folder pages have a media button next to the display options. It names what the page shows: **All media**, **Photos only**, **Videos only**, **Screenshots only** or **Documents only**. Click it to pick another. While a filter is on, the button is highlighted, the header says what the page shows, and **Show all** next to it goes back to all media. On a phone the button is an icon with a dot while a filter is on.

The choice is part of the page address (for example `?media=videos`), so it survives a reload and can be bookmarked. Every page starts with all media: the saved default of the [timeline filter](#filtering-the-timeline) never applies here.

Selecting all photos on a filtered list selects only what it shows. In Trash, filter to **Videos only**, then **Select all** and **Delete permanently** removes the trashed videos and leaves every other photo in the trash.

### Without Timestamp

Photos that don't have a date/time in their EXIF metadata. Useful for finding and fixing photos with missing timestamps.

To give them a date, select them and choose **Change date and time…** from the selection actions menu, then **Set** (see [Changing the date of many photos](#changing-the-date-of-many-photos)). _Not released yet._

### Without Location

<Since version="1.4.0" />

Photos that have no GPS coordinates, oldest added first. Open a photo and set its location from the [Location](#location) section of the details sidebar; once it has coordinates it leaves this view. A photo whose coordinates could not be turned into a place name still has a location, so it is not listed here.

To give many of them one place, select them and choose **Set location…** from the selection actions menu (see [Setting the location of many photos](./places.md#setting-the-location-of-many-photos)). **Select all** reaches every photo on the page, not only the ones loaded so far, and the page has the [media filter](#media-filter).

### Not in an Album {#not-in-an-album}

<Since version="1.4.0" />

Your photos that are in none of your own albums, newest first, so you can see what is left to sort. An album another user shares with you does not count: a photo of yours that is only in their album still shows up here. Hidden and trashed photos are left out.

Open it from the Photos view switcher in the page header (under **Without Timestamp** and **Without Location**) or from the command palette (`Ctrl+K`, "not in an album"). Select photos and add them to an album from the selection actions; they leave the list once it refreshes. **Select all** reaches every photo on the page, not only the ones loaded so far, and the page has the [media filter](#media-filter).

### My Public Photos

Photos you've marked as publicly visible, accessible at your public profile URL.

### Folders

Browse your photos by filesystem directory structure. The root view shows the subfolders of your scan directory, each with a count of the photos inside it (including photos in nested subfolders). Click into any folder to see its photos and subfolders. Only folders that contain indexed photos are listed — folders that are empty, hidden (names starting with `.`), or not yet scanned will not appear.

---

## Photo Viewer (Lightbox)

When you click on any photo in LibrePhotos, it opens in the photo viewer (also known as the lightbox). This provides a full-screen view of your photo with navigation controls and a details sidebar. The photo sits on a plain black background in light and dark mode, so nothing of the page behind it changes how its colours and exposure look. (Not released yet: up to 1.3.0, the page showed through a dimmed, blurred layer around the photo.)

### Navigation

- **Arrow keys** or **swipe** to navigate between photos
- **Thumbnail bar** at the bottom shows nearby photos for quick navigation
- **Close button** (X) or press **Escape** to return to the gallery

### Linking to a photo {#photo-link}

The open photo is part of the page's address, as `?photo=<id>` (for example `/favorites?photo=<id>` or `/album/user/12?photo=<id>`). (Not released yet: up to 1.3.0, opening a photo left the address as it was.) That gives you:

- **Back** in the browser, or the back gesture on a phone, closes the photo and leaves the grid where it was, scrolled to the photo you looked at last. Stepping to the next or previous photo does not add a step to the history, so one Back always closes the viewer.
- **Reload** reopens the same photo.
- **A link to this photo in this view**: copy the address while the photo is open. Whoever opens it sees the same page with that photo open, and can step through the rest of the list from there. A photo the list does not hold (on a page of the timeline that has not loaded yet, or hidden by a filter) opens on its own, without previous and next. A photo the person may not see, or that no longer exists, leaves the grid as it is.

On a [public album](./sharing.md#the-public-album-experience) the same works for visitors, as long as the photo is in the album. The [photo page](#photo-page) at `/photo/<id>` is a separate page for one photo, without the list around it.

### Toolbar

The toolbar at the top provides quick actions. From left to right:

- **Slideshow** - Start or stop an automatic slideshow. While it runs, a dropdown lets you choose the interval (3, 5, 10, 15 or 30 seconds).
- **Select text in photo** - Lay the recognised text over the photo so you can select and copy it. Shown only on your own photos where [text recognition](./text-recognition.md) found text.
- **Zoom in / Zoom out** - Magnify the image. Available for still photos only, not videos.
- **Fullscreen** - Enter or leave fullscreen mode for distraction-free viewing.
- **Copy to clipboard** - Copy the photo as an image to your clipboard, ready to paste into a chat, a document or an email. It copies the display-size version the viewer shows; use **Download** for the original file. The button is shown for still photos, and only when LibrePhotos is served over HTTPS, because browsers allow clipboard access on secure pages only.
- **Hide / Show** (eye icon) - Hide the photo everywhere but the Hidden page, or unhide it.
- **Archive / Unarchive** (box icon) - Take the photo off the timeline and Memories, or put it back (see [Archive](#archive)). The box is teal while the photo is archived.
- **Favorite** (star icon) - Mark the photo as a favorite, or remove the mark. In stars mode this is a row of five stars instead (see [Rating photos with stars](#rating-photos-with-stars)).
- **Share link** (globe icon) - Create a revocable link to this one photo and show it with a copy button, plus **Replace link** and **Revoke**. The globe is green while the photo has a live link. This does not make the photo public; see [Revocable Photo Links](./sharing.md#revocable-photo-links).
- **Delete** - Move the photo to trash.
- **Rotate counter-clockwise** / **Rotate clockwise** - Rotate the photo 90° in either direction (see [Rotating Photos](#rotating-photos)).
- **Toggle info panel** - Show or hide the photo details sidebar.
- **Close** - Return to the gallery.

The Hide, Archive, Favorite, Share link, Delete and Rotate controls are only shown when you are signed in. On a public or shared album page the toolbar shows just the slideshow, zoom, fullscreen, copy, info-panel and close buttons.

There is no download or share button in the lightbox itself. To download photos, select them in the gallery grid and choose **Download** from the selection actions menu; the download dialog can also include the other photos from each selected photo's stack. To share photos with other users, select them in the grid and choose **Sharing** from the same menu.

To put a single photo on the clipboard, open it and press the **Copy to clipboard** button or `Ctrl` + `c` (`⌘` + `c` on macOS). The browser's own right-click menu on the picture offers **Copy image** as well.

### Rotating Photos

The two rotate buttons in the toolbar let you reorient a photo in 90° steps — useful for images that were captured at the wrong angle or whose EXIF Orientation tag is missing or incorrect.

Rotation in LibrePhotos is **non-destructive**:

- The original image file on disk is **not modified**. Instead, the rotation is recorded as an EXIF Orientation override stored in the database, and the thumbnails are regenerated so the new orientation is visible everywhere in the UI.
- Each click composes on top of the previous rotation, so two clicks of the clockwise button produce a 180° rotation and four clicks return the photo to its original orientation.
- The change applies to the photo for every viewer, not just your own session.
- Rotation is only available for still images. Videos cannot be rotated from the lightbox.

Your **Write edits to files** setting (Settings → Metadata) controls whether the rotation also reaches the filesystem. This is a three-way choice, not an on/off toggle:

- **Off**, the default: only the LibrePhotos database and thumbnails are updated, and the file on disk stays byte-for-byte identical.
- **Save to sidecar**: the original stays untouched and the new orientation is written to the photo's XMP sidecar as `XMP-tiff:Orientation`, for every image format. Apps that take the orientation from a sidecar, such as digiKam, show the photo turned the same way (darktable ignores it). The value is relative to the image as stored in the file: for a HEIC or AVIF photo it starts from the file's own rotation (its `irot` and `imir`), not from its EXIF Orientation, which can disagree.
- **Save to media file**: for JPEG, PNG, TIFF and WebP files, LibrePhotos writes the new EXIF Orientation into the original, so every viewer shows the rotation. HEIC, AVIF, RAW and the other formats are not rewritten: their viewers ignore that tag, so the rotation stays in LibrePhotos.

_Not released yet: up to 1.3.0, a rotation never reached the sidecar, and **Save to media file** wrote a wrong EXIF Orientation into HEIC, AVIF and RAW originals (often the opposite turn), replacing the camera's own value. LibrePhotos' own thumbnails were not affected. If another app shows such a file turned the wrong way, set its orientation there or with `exiftool -Orientation=...`._

## Photo Details Sidebar

The sidebar displays detailed information about the current photo and provides quick access to related content.

While you edit the date, the caption, the tags or the location, a dimmed line under the editor says where the change is kept: **Saved in LibrePhotos only**, or **Saved in LibrePhotos and written to the sidecar file** (or **to the photo file**). It follows your [Write edits to files](./settings/index.md#metadata-options) setting, which its **Settings** link opens. All four are written to files. _Not released yet._

### Unsaved changes {#unsaved-changes}

An edit is kept only once you save it: the check (✓) of the date, caption and tags editors, or **Save** in the location picker. While the date, caption or tags you typed differ from what is saved, an orange **Unsaved** mark sits next to that editor's title. With such an edit, or a spot picked in the location picker and not saved yet, stepping to another photo (with the arrows, the arrow keys or a swipe), picking a stack or similar photo, closing the viewer, or going **Back** then asks **Discard unsaved changes?** first: **Keep editing** leaves you where you were with your text intact, **Discard** drops the edit and goes on. An editor you opened but did not change never asks. On the [photo page](#photo-page), leaving with an unsaved edit asks **Leave without saving?**, and reloading or closing the tab asks through the browser's own dialog in both places. _Not released yet._

### Timestamp

Shows when the photo was taken. You can click the edit button to modify the date and time if needed. **Save** stays greyed out while the time field is empty or incomplete, and the editor stays open until the date is saved; if the save fails, LibrePhotos says so and your input is kept. After a save, an **Undo timestamp modification** button next to the date puts the previous date back.

A date you set this way wins over the [date rules](./settings/date-rules.md) and is marked **Set by you**. To drop it, edit the date and click **Remove timestamp**: the date rules decide the photo's date again, so it keeps a date read from its file if it has one. _Not released yet._

### Changing the date of many photos

A camera with a wrong clock, or one left on summer time, puts a whole trip off by the same amount. To fix it, select the photos in the grid (or **Select all**), open the selection actions menu (⋮) and choose **Change date and time…**. The dialog has two tabs:

- **Shift** moves every selected photo by the same amount, so their order and the time between them stay the same. Pick **Earlier** or **Later** and enter the days, hours, minutes and seconds, or click **1 h earlier** or **1 h later**. A line spells out the shift ("1 hour, 30 minutes earlier"), and a table shows the oldest and newest selected photo now and after the shift. **Shift** stays greyed out until the amount is more than zero. Photos without a date are left alone; the dialog says how many.
- **Set** gives every selected photo the same date and time, picked with the same calendar and time field as the [Timestamp](#timestamp) editor. Use it for scans and photos without a date. The photos then share one time, so their order on the timeline is lost.

When you save, a message says how many photos got their new date and how many a shift skipped. The new dates count as set by you: they win over the [date rules](./settings/date-rules.md), a rescan keeps them, and **Remove timestamp** in a photo's [Timestamp](#timestamp) editor hands that photo back to the rules. With [Write edits to files](./settings/index.md#metadata-options) on, LibrePhotos writes them to the photos' files or sidecars in the background, as `XMP:DateCreated`. _Not released yet._

### File & Camera Info

Near the top of the sidebar, LibrePhotos shows a summary of the current file: the filename (a link that opens the original file in a new tab), the image dimensions, megapixels and file size (for a video: its dimensions, duration, codec and size), and, when the photo has more than one file, the **+N formats** toggle described under [File Variants](#file-variants) below.

When the photo carries camera EXIF, two rows follow, as on a camera's own info screen:

- **Camera**: the camera's make and model, with the shutter speed, the ISO and the exposure bias (`1/250 · ISO 200 · +0.7 EV`).
- **Lens**: the lens, with the aperture and the focal length, plus its 35 mm equivalent when that differs (`ƒ/5.6 · 23 mm (35 mm equiv.)`).

A row the photo has nothing for is left out; without a lens name, the aperture and focal length join the camera row. Numbers follow your interface language, so German shows `ƒ/5,6` and `8,4 MB`. A shutter speed of a quarter second or longer is given in seconds (`2.5 s`).

**Show more** reveals the rest, with labels: whether the flash fired, the white balance, the metering mode, the subject distance and the digital zoom, then the folder of the file and any duplicate file copies. The button is not shown when there is nothing more. For the full list of EXIF fields, see [EXIF Data](./exif-data.md). _Not released yet: up to 1.3.0 the camera and lens shared one line, without the exposure bias, the megapixels, the flash, white balance or metering mode._

### File Variants

If a photo has multiple file variants (e.g., RAW+JPEG pairs, Live Photos with embedded video, or edited copies), the file info row shows a **+N formats** toggle that lists them with type badges (JPG, RAW, VIDEO, META). Downloading a photo always includes every one of its file variants in the zip — there is no separate option for that. The download dialog's only checkbox, **"Include all photos from stacks"**, controls whether the other photos from the same *stack* (bursts, brackets, manual stacks) are added as well. A RAW badge overlay is shown on photos that have RAW file variants.

For more details on how file variants and stacks work, see [Stacks & File Variants](./stacks-and-file-variants.md).

### Category

<Since version="1.3.0" />

LibrePhotos detects screenshots while scanning and documents (receipts, letters, forms) from their text, and the **Classify Media Categories** job (listed on the Jobs page) re-runs both over the library. The category is the badge at the end of the filename row in [File & Camera Info](#file--camera-info). When it is wrong, click the badge and pick **Photo**, **Screenshot** or **Document**. The menu also says whether the category was **Detected automatically** or **Set by you**, and where the item appears with your saved [timeline filter](#filtering-the-timeline). A notification with **Undo** confirms the change; undoing a correction of a detected category hands the item back to the detectors. Videos get the badge only when they were wrongly flagged, and can only be set back to **Photo**.

A category you set is kept: rescanning the library or running Classify Media Categories again never overwrites it. The control is shown on your own photos only.

To fix many items at once, select them in the grid and choose **Mark as photo**, **Mark as screenshot** or **Mark as document** from the selection actions menu.

### Location

Displays the location where the photo was taken (if GPS data is available). An interactive map shows where the shot was made — you can pan and zoom it with the on-map navigation controls, and clicking the marker opens a small popup with the photo's thumbnail. To set or correct a location, click the pencil icon next to the place name to open the **Pick location** dialog. (The pencil is hidden on publicly shared photos.)

On your own photos, the coordinates are shown under the place name (`37.08990, -8.41280`), with a button that copies them in that form for a map or a search box, and the altitude when the photo has one (`31 m above sea level`). The copy button needs HTTPS, like copying an image. People you share a photo with, and visitors of a public album, never see this line. _Not released yet._

### People

Shows faces detected in the photo. You can:

- Click on a face to view all photos of that person
- Edit the person's name by clicking the edit button
- Mark a face as "Not this person" if incorrectly identified

### Caption

The AI-generated or manually entered caption for the photo. You can:

- View the things OpenCLIP detected, displayed as green badges under **Things**; click one to search for it
- Edit the caption manually — type `#` to get autocomplete suggestions for thing album tags
- Generate a new AI caption using the suggestion button
- Use the **AI suggestion button** to quickly fill in a machine-generated caption

### Tags

Your own tags for the photo, shown as teal badges. This section always appears in the sidebar when you are signed in, showing **No tags** when none are set. Click the pencil button to open an editor where you can add or remove tags — separate entries with a comma, and existing tags are offered as autocomplete suggestions, the ones beginning with what you typed first — then use the check to save or the X to cancel. Click a tag badge to open that tag's album.

Tags also come from the photo file: a scan turns each keyword stored in it (XMP `Subject`, IPTC `Keywords`, the `PersonInImage` names and the last level of each `HierarchicalSubject` keyword, including `.xmp` sidecars) into a tag. Those tags carry a small file icon, and hovering or focusing one says **From the file's keywords**. You edit them like any other tag. With [Write edits to files](./settings/index.md#metadata-options) set to `Off`, removing one here does not change the file, so a rescan adds it back, and the editor says so. With a sidecar or the media file chosen, your tag changes are written to the file's keywords (see [EXIF Data](./exif-data.md#what-librephotos-writes)) and a removed tag stays removed (not released yet). _Not released yet:_ earlier versions showed the file's keywords in a separate **Keywords** section below the tags.

These are not the same as the **Things** list under the caption: those come from OpenCLIP and are not editable here.

To tag many photos in one go, select them in the grid and press **`t`** instead — see [Tagging photos](./albums.md#tagging-photos).

Tags are not shown on public or shared album pages.

### Albums

Shows which user albums contain this photo. Each album is displayed with:

- **Cover photo thumbnail** - A preview of the album's cover
- **Album title** - Click to navigate directly to that album
- **Photo count** - Number of photos in the album

This makes it easy to see the context of a photo and quickly jump to related albums without leaving the photo viewer.

### Similar Photos

Displays photos that are visually similar to the current one. This is useful for:

- Finding duplicates
- Discovering related photos from the same event
- Browsing photos with similar content

Click on any similar photo to view it directly.

## Photo Page

Every photo also has a page of its own at `/photo/<id>`. You get there from a link to the photo, by `Ctrl` + clicking (`⌘` + click on macOS) a photo in a grid, and from a similar photo in the details.

:::note
<Since version="1.4.0" /> Up to 1.3.0 the page was titled with the file name and its full folder path and had no actions.
:::

The photo or video is shown as large as the window allows on a neutral background, with **Back** above it (to where you came from, or to the timeline when you opened a link) and **Open in viewer** below it. Open in viewer shows the photo in the [lightbox](#photo-viewer-lightbox), for zoom, fullscreen, the slideshow and the keyboard shortcuts. When [text recognition](./text-recognition.md) found text in one of your photos, a **Select text in photo** button lays it over the photo there too.

Beside the photo (below it on a phone), the page title is the date the photo was taken, with the time and the place under it. On your own photos the pencil next to the date opens the date editor described under [Timestamp](#timestamp).

Under the title, labelled buttons hold the photo's actions:

- **Favorite**: mark the photo as a favorite, or remove the mark. The button is yellow while it is one. In stars mode it is a wider **Rating** tile with five stars instead, which work as in the photo viewer (see [Rating photos with stars](#rating-photos-with-stars)).
- **Share**: create a revocable link to this photo, as the globe in the lightbox does (see [Revocable Photo Links](./sharing.md#revocable-photo-links)). The button is green while the photo has a live link.
- **Album**: add the photo to one of your albums, or to a new one.
- **Download**: download the original file. When the photo has more than one file (a RAW next to its JPEG, the video of a Live Photo), it opens a list to pick the file from.
- **More**: **Copy image** (still photos, HTTPS only), **Rotate 90° counter-clockwise** and **Rotate 90° clockwise** (still photos), **Hide photo** / **Show photo**, **Archive photo** / **Unarchive photo**, **Open in viewer**, and **Move to trash** / **Restore from trash**.

A photo in the trash, hidden or archived says so above these buttons, with a button to restore it, show it again or unarchive it.

Then each subject has a card, with the same editors as the [details sidebar](#photo-details-sidebar):

- **People**: the faces in the photo. Hovering one marks it on the photo; you can name a face, confirm a suggested name, mark it as not this person, delete it, or mark a face the scan missed with the button at the top of the card.
- **Caption**: your caption, with the **Things** found in the photo under it.
- **Tags**: your tags, marked when they came from the file's keywords.
- **Place**: the address and a map; the pencil opens **Pick location**.
- **Place**'s coordinates line, with the copy button and the altitude, is the same as in the [Location](#location) section.
- **Camera**: the camera and lens, with aperture, shutter speed, focal length (and its 35 mm equivalent) and ISO, the exposure bias, and the same **Show more** list as the sidebar.
- **File**: the file name (it opens the original), its dimensions, megapixels and size (a video's duration and codec), the [Category](#category) badge, the photo's other formats with a download button each, the folder it is in below your library folder, copies of the file and its stack.
- **Albums** and **Similar Photos**, when there are any.

Details a photo does not have yet are not listed as empty cards: they are buttons in one **Add details** card (**Add a caption**, **Add tags**, **Add a place**, **Mark a face**). Each opens its editor straight away.

On a photo someone shared with you, the page shows the photo, its date and the name of its place, **Open in viewer** and **Copy image**, and says who shared it. Everything else stays with the owner, as in the lightbox.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / Next photo |
| `Shift` + `←` / `→` | Jump back / forward 10 seconds (videos only) |
| `Ctrl` + `←` / `→` | Jump back / forward 1 minute (videos only) |
| `Escape` | Close photo viewer |
| `Space` | Play / pause (videos only) |
| `z` | Toggle zoom (still images only) |
| `i` | Toggle sidebar |
| `f` | Toggle favorite (favorites mode) |
| `0` - `5` | Set the star rating, `0` clears it (stars mode) |
| `h` | Hide / unhide photo |
| `a` | Archive / unarchive photo |
| `p` | Open the photo's share link dialog |
| `d` | Move photo to trash |
| `g` | Toggle fullscreen |
| `s` | Start / stop slideshow |
| `t` | Select text in the photo / stop selecting it (only on your own photos where [text was recognised](./text-recognition.md#selecting-text-in-the-photo-viewer)) |
| `Ctrl` + `c` (`⌘` + `c` on macOS) | Copy the photo to the clipboard (still images only; when text is selected, the browser copies the text instead) |

The `f`, `0`-`5`, `h`, `a`, `p` and `d` shortcuts act on the current photo and are disabled on public (unauthenticated) album pages. `f` does nothing in stars mode and `0`-`5` do nothing in favorites mode.

### Seeking in Videos

`Space` starts and pauses a video. Holding `Shift` with the arrow keys jumps ten seconds back or forward, and holding `Ctrl` instead jumps a full minute — the same split VLC makes between a short and a long jump. The plain arrow keys keep moving between photos even while a video is playing, so skipping through a clip never costs you your place in the album. Each jump is confirmed on screen — the player's own control bar stays hidden when you drive it from the keyboard, so there would otherwise be nothing to see.

On macOS, `Ctrl` with the arrow keys is claimed by Mission Control for switching between desktops, so the one-minute jump may not reach the page there; `Shift` is unaffected.

Seeking is unavailable while a video is still being converted for playback: the first time you play a video your browser cannot play as it is, or any video when you have **Always transcode videos** turned on in your settings. For as long as that conversion is running the browser is never told how long the video is or how to jump within it, so the player says so rather than ignoring the key.

### Videos your browser cannot play

Not every browser plays every video. H.265 (HEVC), which most phones record in, plays in Safari, and in Chrome and Edge on a machine with a hardware decoder for it, but not in Firefox or in Chrome without one. Older cameras' formats, such as MPEG-2 or Motion JPEG, play nowhere.

LibrePhotos asks your browser, for each video, whether it can play it. If it can, you get the original at full resolution. If it cannot, the video is converted to H.264 for you as it plays, capped at 720 lines, and kept for the next time you watch it (see [Experimental options](./settings/index.md#experimental-options) for how converted copies are stored). A video your browser says it can play but then fails to decode is converted the same way, automatically. You do not need **Always transcode videos** for any of this.

This applies to you and to anyone you share a video with who signs in. Visitors to a public album without an account are always served the original.

:::note
<Since version="1.3.0" /> On 1.2.1 and older, a video your browser could not play needed **Always transcode videos**.
:::

### HDR Videos

Most phones record video in HDR by default: iPhones in Dolby Vision, most Android phones in HLG. Wherever LibrePhotos converts such a video — the gallery thumbnails, and playback whenever it is converted (see [Videos your browser cannot play](#videos-your-browser-cannot-play)) — it maps the picture down to ordinary SDR colours, so it looks like itself instead of washed out and grey.

In the photo grid, an HDR video carries an **HDR** badge next to its duration. Whether a video is HDR is worked out once, when the scan adds it, together with its codec and pixel format. Videos that were already in your library before this existed are checked by the **Probe Videos** job, which runs by itself after your next scan and rebuilds the thumbnails of the HDR ones, and of any 10-bit or 4:2:2 ones, so thumbnails that looked washed out or did not play are corrected then. See [Job System](./job-system.md#probe-videos).

:::note
The HDR badge, the scan-time check and **Probe Videos** are new in 1.3.0. 1.2.0 and 1.2.1 already mapped HDR videos to SDR, but could turn bright skies and highlights flat white; older releases converted them washed out.
:::
