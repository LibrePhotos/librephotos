---
title: "🖼️ Viewing Photos"
description: "Photo views, the lightbox, and the photo details sidebar"
sidebar_position: 2
---

## Photo Views

LibrePhotos provides several ways to browse your photo library. You can switch between views using the navigation menu or the header dropdown on the main timeline.

### Timeline (Home)

The default view showing all your photos grouped by date, from newest to oldest. A **scroll scrubber** on the right edge lets you quickly jump to any date — click or drag it to navigate through large libraries.

### Favorites

Photos you've marked as favorites. To favorite a photo, click the star icon in the lightbox toolbar (or press `f`), or use the selection actions menu. The star turns yellow once the photo's rating reaches the **Minimum image rating to interpret as favorite** value in your user settings.

### Hidden

Photos you've hidden from the main timeline. Hiding a photo removes it from the default view without deleting it. To hide photos, select them and choose **"Hide"** from the selection actions menu.

### Recently Added

Shows only your most recent batch of imports — the photos whose *added* date falls on the same calendar day as the most recently added photo in your library. They appear in a single flat grid under one **"Added on …"** line in the page header; there is no per-day grouping. Older imports are not listed here — use the Timeline to browse your whole library.

### Photos Only

Shows only still photos, filtering out all videos.

### Videos Only

Shows only video files, filtering out all still photos.

### Without Timestamp

Photos that don't have a date/time in their EXIF metadata. Useful for finding and fixing photos with missing timestamps.

### My Public Photos

Photos you've marked as publicly visible, accessible at your public profile URL.

### Folders

Browse your photos by filesystem directory structure. The root view shows the subfolders of your scan directory, each with a count of the photos inside it (including photos in nested subfolders). Click into any folder to see its photos and subfolders. Only folders that contain indexed photos are listed — folders that are empty, hidden (names starting with `.`), or not yet scanned will not appear.

---

## Photo Viewer (Lightbox)

When you click on any photo in LibrePhotos, it opens in the photo viewer (also known as the lightbox). This provides a full-screen view of your photo with navigation controls and a details sidebar.

### Navigation

- **Arrow keys** or **swipe** to navigate between photos
- **Thumbnail bar** at the bottom shows nearby photos for quick navigation
- **Close button** (X) or press **Escape** to return to the gallery

### Toolbar

The toolbar at the top provides quick actions. From left to right:

- **Slideshow** - Start or stop an automatic slideshow. While it runs, a dropdown lets you choose the interval (3, 5, 10, 15 or 30 seconds).
- **Zoom in / Zoom out** - Magnify the image. Available for still photos only, not videos.
- **Fullscreen** - Enter or leave fullscreen mode for distraction-free viewing.
- **Hide / Show** (eye icon) - Hide the photo from the main timeline, or unhide it.
- **Favorite** (star icon) - Mark the photo as a favorite, or remove the mark.
- **Make public / Make private** (globe icon) - Toggle the photo's public visibility. Toggling in either direction also copies a link to the photo to your clipboard.
- **Delete** - Move the photo to trash.
- **Rotate counter-clockwise** / **Rotate clockwise** - Rotate the photo 90° in either direction (see [Rotating Photos](#rotating-photos)).
- **Toggle info panel** - Show or hide the photo details sidebar.
- **Close** - Return to the gallery.

The Hide, Favorite, Make public, Delete and Rotate controls are only shown when you are signed in. On a public or shared album page the toolbar shows just the slideshow, zoom, fullscreen, info-panel and close buttons.

There is no download or share button in the lightbox itself. To download photos, select them in the gallery grid and choose **Download** from the selection actions menu; the download dialog can also include the other photos from each selected photo's stack. To share photos with other users, select them in the grid and choose **Sharing** from the same menu.

### Rotating Photos

The two rotate buttons in the toolbar let you reorient a photo in 90° steps — useful for images that were captured at the wrong angle or whose EXIF Orientation tag is missing or incorrect.

Rotation in LibrePhotos is **non-destructive**:

- The original image file on disk is **not modified**. Instead, the rotation is recorded as an EXIF Orientation override stored in the database, and the thumbnails are regenerated so the new orientation is visible everywhere in the UI.
- Each click composes on top of the previous rotation, so two clicks of the clockwise button produce a 180° rotation and four clicks return the photo to its original orientation.
- The change applies to the photo for every viewer, not just your own session.
- Rotation is only available for still images. Videos cannot be rotated from the lightbox.

Your **Synchronize metadata to disk** setting (Settings → Metadata) controls whether the rotation also reaches the filesystem. This is a three-way choice, not an on/off toggle. With **Save to media file**, LibrePhotos writes the combined EXIF Orientation tag into the original file; with **Save to sidecar**, it writes it to the photo's XMP sidecar instead — either way the new orientation becomes visible in external tools. With **Off** — the default — only the LibrePhotos database and thumbnails are updated, and the file on disk stays byte-for-byte identical.

## Photo Details Sidebar

The sidebar displays detailed information about the current photo and provides quick access to related content.

### Timestamp

Shows when the photo was taken. You can click the edit button to modify the date and time if needed.

### File & Camera Info

Near the top of the sidebar, LibrePhotos shows a summary of the current file: the filename (a link that opens the original file in a new tab), the image dimensions and file size, and — when the photo has more than one file — the **+N formats** toggle described under [File Variants](#file-variants) below. When the photo carries camera EXIF, a second line lists the camera and lens with the aperture, shutter speed, focal length and ISO; this line is hidden if the photo has no camera information. A **Show more** button reveals additional details such as the file path, subject distance, digital zoom ratio, 35 mm-equivalent focal length and any duplicate file copies. For the full list of EXIF fields, see [EXIF Data](./exif-data.md).

### File Variants

If a photo has multiple file variants (e.g., RAW+JPEG pairs, Live Photos with embedded video, or edited copies), the file info row shows a **+N formats** toggle that lists them with type badges (JPG, RAW, VIDEO, META). Downloading a photo always includes every one of its file variants in the zip — there is no separate option for that. The download dialog's only checkbox, **"Include all photos from stacks"**, controls whether the other photos from the same *stack* (bursts, brackets, manual stacks) are added as well. A RAW badge overlay is shown on photos that have RAW file variants.

For more details on how file variants and stacks work, see [Stacks & File Variants](./stacks-and-file-variants.md).

### Location

Displays the location where the photo was taken (if GPS data is available). An interactive map shows where the shot was made — you can pan and zoom it with the on-map navigation controls, and clicking the marker opens a small popup with the photo's thumbnail. To set or correct a location, click the pencil icon next to the place name to open the **Pick location** dialog. (The pencil is hidden on publicly shared photos.)

### People

Shows faces detected in the photo. You can:

- Click on a face to view all photos of that person
- Edit the person's name by clicking the edit button
- Mark a face as "Not this person" if incorrectly identified

### Caption

The AI-generated or manually entered caption for the photo. You can:

- View auto-generated tags from the active tagging model, displayed as color-coded badges. SigLIP 2 shows a **Tags** list with green badges; Places365 shows a **Scene** block split into **Attributes** (blue badges) and **Categories** (teal badges)
- Edit the caption manually — type `#` to get autocomplete suggestions for thing album tags
- Generate a new AI caption using the suggestion button
- Use the **AI suggestion button** to quickly fill in a machine-generated caption

Tags from each model are stored independently, but the lightbox only shows tags from the model currently selected in your site settings. Switching the tagging model changes which tags appear; previously generated tags stay in the database.

### Tags

Your own tags for the photo, shown as teal badges. This section always appears in the sidebar when you are signed in, showing **No tags** when none are set. Click the pencil button to open an editor where you can add or remove tags — separate entries with a comma, and existing tags are offered as autocomplete suggestions — then use the check to save or the X to cancel. Click a tag badge to open that tag's album.

These are not the same as the automatic **Tags** list SigLIP 2 adds under the caption: those come from the tagging model and are not editable here.

Tags are not shown on public or shared album pages.

### Keywords

Keywords stored in the photo's own metadata (XMP `Subject` and IPTC `Keywords`). This section always appears in the sidebar when you are signed in, showing **No keywords** when none are set. Click the pencil button to open an editor where you can add or remove keywords — separate entries with a comma or a space — then use the check to save or the X to cancel. Saved keywords are written back through the photo metadata. Click any keyword badge to search your library for that term.

Keywords are not shown on public or shared album pages.

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

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / Next photo |
| `Escape` | Close photo viewer |
| `Space` | Play / pause (videos only) |
| `z` | Toggle zoom (still images only) |
| `i` | Toggle sidebar |
| `f` | Toggle favorite |
| `h` | Hide / unhide photo |
| `p` | Make public / private (copies the link to your clipboard) |
| `d` | Move photo to trash |
| `g` | Toggle fullscreen |
| `s` | Start / stop slideshow |

The `f`, `h`, `p` and `d` shortcuts act on the current photo and are disabled on public (unauthenticated) album pages.

