---
title: "📚 Stacks & File Variants"
excerpt: "How LibrePhotos handles RAW+JPEG pairs, Live Photos, bursts, and other related photo groups"
sidebar_position: 7
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

1. **Phase 1 — Grouping**: Before processing, all files are grouped by their directory and base filename. For example, `IMG_001.jpg`, `IMG_001.CR2`, and `IMG_001.xmp` in the same folder become one group.

2. **Phase 2 — Processing**: Each group is processed together, creating one Photo entity with all files attached as variants. The main display file is chosen automatically by priority: JPEG → Video → RAW → Metadata.

After each scan, a **Repair File Variants** job runs automatically to fix any files that were previously scanned separately before the variant system was introduced.

### Viewing File Variants

When viewing a photo that has file variants:

- A **RAW badge** appears on the thumbnail in the photo grid
- The **File Variants** section in the lightbox sidebar lists all variants with type badges (RAW, Live Photo, etc.)
- The primary variant is marked with a **Main** badge
- You can download individual variants or include all variants when downloading as a zip

### Settings

In **Settings**, you can configure:

- **Stack RAW+JPEG** — Toggle whether RAW+JPEG pairs should be automatically grouped during scanning

## Stacks

Stacks group different but related captures together. Unlike file variants (same shot, different format), stacks contain separate photos that belong together logically.

### Stack Types

| Type | Description | Detection |
|------|-------------|-----------|
| **Burst** | A rapid sequence of photos taken in burst mode | Automatic (via EXIF data, filename patterns, and timestamp proximity) |
| **Bracket** | Exposure brackets for HDR | Manual |
| **Manual** | Any photos you want to group together | Manual |

### Automatic Stack Detection

LibrePhotos can automatically detect burst sequences by analyzing:

- **EXIF data** — Burst mode flags and sequence metadata
- **Filename patterns** — Common burst naming conventions
- **Timestamp proximity** — Photos taken within milliseconds of each other
- **Visual similarity** — Comparing photo content

You can trigger stack detection from the **Organizing → Stacks** page by clicking **"Detect Stacks"** and choosing which types to detect.

### The Organizing Page

The **Organizing** page (accessible from the navigation) is your central hub for managing stacks and duplicates. It has two tabs:

#### Stacks Tab

- Browse all detected stacks
- Filter by stack type (All, Burst, Bracket, Manual)
- Click a stack to open the **Stack Modal** showing all photos in the group with details (resolution, file size, camera, date)
- **Set Cover** — Choose which photo represents the stack in the timeline
- **Unstack** — Remove the grouping
- **View in Lightbox** — Browse stack photos in the full lightbox viewer

#### Creating Manual Stacks

1. Select multiple photos from any view
2. Open the selection actions menu (three-dot menu)
3. Click **"Create Stack"**
4. The selected photos are grouped into a manual stack

#### Managing Stacks

From the selection actions menu, you can also:

- **Merge Stacks** — Combine multiple stacks into one
- **Remove from Stack** — Take selected photos out of a stack
- **Set as Cover** — Choose the primary photo for a stack

### Stacks in the Lightbox

When viewing a photo that belongs to a stack:

- The **Stacks** section in the sidebar shows thumbnail previews of other photos in the stack
- Click any thumbnail to switch to that photo
- Click **"View full stack"** to open the Stack Modal
- If a photo is in multiple stacks, they are shown in an accordion grouped by type
