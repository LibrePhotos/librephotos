---
title: "📚 Stacks & File Variants"
description: "How LibrePhotos handles RAW+JPEG pairs, Live Photos, bursts, and other related photo groups"
sidebar_position: 13
---

LibrePhotos can automatically detect and group related photos together. There are two distinct concepts: **file variants** (same capture in different formats) and **stacks** (different captures grouped together).

## File Variants

File variants represent the same moment captured in different file formats. Instead of showing duplicate entries in your timeline, LibrePhotos treats them as a single photo with multiple files attached.

### RAW+JPEG Pairs

When you shoot in RAW+JPEG mode, your camera creates two files for each shot (e.g. `IMG_001.CR2` and `IMG_001.jpg`). LibrePhotos groups these automatically during scanning — you'll see one photo in your timeline with a **RAW badge** overlay indicating that a RAW variant is available.

### Live Photos

Live Photos (common on iPhones) consist of a still image and a short video clip. LibrePhotos detects these and groups the image and video as file variants of a single photo.

### How Scanning Groups Variants

LibrePhotos uses a two-phase scan to group file variants:

1. **Phase 1 — Grouping**: Before processing, all image and video files are grouped by their directory and base filename. For example, `IMG_001.jpg` and `IMG_001.CR2` in the same folder become one group. XMP sidecars are set aside at this stage.

2. **Phase 2 — Processing**: Each group is processed together, creating one Photo entity with all files attached as variants. The main display file is chosen automatically by priority: JPEG → Video → RAW. Once all image groups have finished, any XMP sidecars are processed and attached to the photo they belong to.

After each scan, a **Repair File Variants** job runs automatically. It looks for RAW files that ended up as their own photo and merges them into the matching image photo (same folder, same base name — JPEG, HEIC, PNG or TIFF), and corrects the main display file when a RAW file is still marked as the main one. Live Photo videos that were already scanned as separate photos are not merged by this job.

### Viewing File Variants

When viewing a photo that has file variants:

- A **RAW badge** appears on the thumbnail in the photo grid
- In the lightbox sidebar, next to the filename (beside the dimensions and file size), a photo with extra formats shows a **+N format(s)** link. Expanding it lists the non-primary variants, each with a format badge (**JPG**, **RAW**, **VIDEO**, **META**, or **FILE**).
- When you download photos as a zip, all file variants of each photo are included automatically.

### Settings

In **Settings**, you can configure:

- **Stack RAW+JPEG** — a legacy switch, left over from when RAW+JPEG pairs were modelled as stacks. RAW+JPEG pairs are now always grouped as file variants during scanning, so turning this off currently has no effect.

## Stacks

Stacks group different but related captures together. Unlike file variants (same shot, different format), stacks contain separate photos that belong together logically.

:::note
Once photos are stacked, only the stack's cover photo appears in your timeline — the other photos stay in your library but are collapsed behind the stack. Open the stack to reach them, use **Set Cover** to change which one is shown, or **Unstack** to bring them all back.
:::

### Stack Types

| Type | Description | Detection |
|------|-------------|-----------|
| **Burst** | A rapid sequence of photos taken in burst mode | Automatic (rule-based: EXIF burst/sequence tags and filename patterns by default) |
| **Bracket** | Exposure brackets for HDR | Reserved — not currently created; there is no bracket detection, and **Create Stack** always makes a Manual stack |
| **Manual** | Any photos you want to group together | Manual |

### Automatic Stack Detection

Burst detection runs a list of rules stored per user. Enabled by default (hard criteria):

- **EXIF Burst Mode Tag** — camera burst / continuous-drive flags
- **EXIF Sequence Number** — sequence metadata written by the camera
- **Filename Burst Pattern** — naming conventions such as `IMG_001_BURST001` or `photo (1)`

Available but **disabled by default** (soft criteria — these estimate, and can group unrelated photos):

- **Timestamp Proximity** — photos taken within a configurable interval of each other (2 seconds by default) on the same camera
- **Visual Similarity** — perceptual-hash comparison of consecutive photos

Open **Settings** and use the **Burst Detection Rules** panel to enable, disable, reorder, add or remove these rules (including extra presets such as a looser 5-second timestamp rule or a custom filename pattern). Changes apply the next time you run **Detect Stacks**.

You can trigger stack detection from the **Organizing → Stacks** page by clicking **"Detect Stacks"** and choosing which types to detect.

### The Organizing Page

The **Organizing** page (accessible from the navigation) is your central hub for managing stacks and duplicates. It has two tabs:

#### Stacks Tab

- Browse all detected stacks
- Filter by stack type — the dropdown offers **All Types** plus each type you actually have stacks of
- Click a stack to open the **Stack Modal** showing all photos in the group with details (resolution, file size, camera, date)
- **Set Cover** — Choose which photo represents the stack in the timeline
- **Unstack** — Remove the grouping
- **View in Lightbox** — Browse stack photos in the full lightbox viewer

#### Creating Manual Stacks

1. Select multiple photos from any view
2. Open the selection actions menu (three-dot menu)
3. Click **"Create Stack"**
4. The selected photos are grouped into a manual stack, and only the cover photo remains visible in your timeline

#### Managing Stacks

From the selection actions menu, you can also:

- **Merge Stacks** — Combine multiple stacks into one
- **Break Apart Stacks** — Remove the selected photos from every manual stack they belong to (a stack is deleted automatically if fewer than 2 photos remain)

### Stacks in the Lightbox

When viewing a photo that belongs to a stack:

- The **Stacks** section in the sidebar shows thumbnail previews of other photos in the stack
- Click any thumbnail to switch to that photo
- Click **"View full stack"** to open the Stack Modal
- If a photo is in multiple stacks, they are shown in an accordion grouped by type
