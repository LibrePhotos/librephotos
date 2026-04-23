---
title: "🖼️ Viewing Photos"
excerpt: "Photo views, the lightbox, and the photo details sidebar"
sidebar_position: 2
---

## Photo Views

LibrePhotos provides several ways to browse your photo library. You can switch between views using the navigation menu or the header dropdown on the main timeline.

### Timeline (Home)

The default view showing all your photos grouped by date, from newest to oldest. A **scroll scrubber** on the right edge lets you quickly jump to any date — click or drag it to navigate through large libraries.

### Favorites

Photos you've marked as favorites. To favorite a photo, click the heart icon in the lightbox toolbar or use the selection actions menu.

### Hidden

Photos you've hidden from the main timeline. Hiding a photo removes it from the default view without deleting it. To hide photos, select them and choose **"Hide"** from the selection actions menu.

### Recently Added

Photos ordered by when they were added to LibrePhotos (import date rather than capture date), grouped by "Added on [date]".

### Photos Only

Shows only still photos, filtering out all videos.

### Videos Only

Shows only video files, filtering out all still photos.

### Without Timestamp

Photos that don't have a date/time in their EXIF metadata. Useful for finding and fixing photos with missing timestamps.

### My Public Photos

Photos you've marked as publicly visible, accessible at your public profile URL.

### Folders

Browse your photos by filesystem directory structure. The root view shows your scan directory's subfolders with aggregated photo counts. Click into any folder to see its photos and subfolders. This mirrors the actual file organization on disk.

---

## Photo Viewer (Lightbox)

When you click on any photo in LibrePhotos, it opens in the photo viewer (also known as the lightbox). This provides a full-screen view of your photo with navigation controls and a details sidebar.

### Navigation

- **Arrow keys** or **swipe** to navigate between photos
- **Thumbnail bar** at the bottom shows nearby photos for quick navigation
- **Close button** (X) or press **Escape** to return to the gallery

### Toolbar

The toolbar at the top provides quick actions:

- **Toggle sidebar** - Show or hide the photo details panel
- **Favorite** - Mark the photo as a favorite
- **Download** - Download the original photo (with options for stacked/variant photos)
- **Share** - Share the photo with other users
- **Delete** - Move the photo to trash
- **Rotate counter-clockwise** - Rotate the photo 90° counter-clockwise (see [Rotating Photos](#rotating-photos))
- **Rotate clockwise** - Rotate the photo 90° clockwise (see [Rotating Photos](#rotating-photos))
- **Fullscreen** - Enter fullscreen mode for distraction-free viewing
- **Slideshow** - Start an automatic slideshow with configurable interval

### Rotating Photos

The two rotate buttons in the toolbar let you reorient a photo in 90° steps — useful for images that were captured at the wrong angle or whose EXIF Orientation tag is missing or incorrect.

Rotation in LibrePhotos is **non-destructive**:

- The original image file on disk is **not modified**. Instead, the rotation is recorded as an EXIF Orientation override stored in the database, and the thumbnails are regenerated so the new orientation is visible everywhere in the UI.
- Each click composes on top of the previous rotation, so two clicks of the clockwise button produce a 180° rotation and four clicks return the photo to its original orientation.
- The change applies to the photo for every viewer, not just your own session.
- Rotation is only available for still images. Videos cannot be rotated from the lightbox.

If you have **"Save metadata to disk"** enabled in your user settings, LibrePhotos will additionally write the combined EXIF Orientation tag back to the original file (or its XMP sidecar), so the new orientation is also visible in external tools. With that setting disabled — the default — only the LibrePhotos database and thumbnails are updated and the file on disk stays byte-for-byte identical.

## Photo Details Sidebar

The sidebar displays detailed information about the current photo and provides quick access to related content.

### Timestamp

Shows when the photo was taken. You can click the edit button to modify the date and time if needed.

### File Variants

If a photo has multiple file variants (e.g., RAW+JPEG pairs, Live Photos with embedded video, or edited copies), they will be displayed here. You can click on any variant to view it, and when downloading, you can choose to include all variants in a zip file. A RAW badge overlay is shown on photos that have RAW file variants.

For more details on how file variants and stacks work, see [Stacks & File Variants](./stacks-and-file-variants.md).

### Location

Displays the location where the photo was taken (if GPS data is available). A small map preview shows the exact location, and clicking it will open a larger map view. You can also edit the location if it's missing or incorrect.

### People

Shows faces detected in the photo. You can:

- Click on a face to view all photos of that person
- Edit the person's name by clicking the edit button
- Mark a face as "Not this person" if incorrectly identified

### Caption

The AI-generated or manually entered caption for the photo. You can:

- View auto-generated tags from the active tagging model, displayed as color-coded badges (green for SigLIP 2, blue for Places365)
- Edit the caption manually — type `#` to get autocomplete suggestions for thing album tags
- Generate a new AI caption using the suggestion button
- Use the **AI suggestion button** to quickly fill in a machine-generated caption

Tags from each model are stored independently. The lightbox shows tags from all models that have been run on the photo, so you can see results side by side.

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
| `i` | Toggle sidebar |
| `f` | Toggle fullscreen |
| `Delete` | Delete photo |
| `s` | Start / stop slideshow |

