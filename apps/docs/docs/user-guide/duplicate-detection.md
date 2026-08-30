---
title: "🔍 Duplicate Detection"
description: "Find and manage duplicate photos in your library"
sidebar_position: 15
---

LibrePhotos can detect duplicate photos in your library using both exact file matching and visual similarity analysis. This helps you reclaim storage space and keep your library clean.

## Types of Duplicates

### Exact Copies

Photos that are byte-for-byte identical. These are detected by comparing file hashes (MD5). This catches files that have been copied to multiple locations or imported more than once.

### Visual Duplicates

Photos that look the same but may differ in resolution, quality, compression, or minor edits. These are detected using **perceptual hashing** — a technique that creates a fingerprint of what an image looks like, rather than its raw bytes. Two images with similar perceptual hashes are visually similar even if the files are technically different.

## How Detection Works

### Perceptual Hashing

LibrePhotos computes a 64-bit perceptual hash (pHash) for each image using a DCT-based (Discrete Cosine Transform) algorithm. This hash captures the visual structure of the image and is robust against:

- Resizing
- Minor compression differences
- Small color adjustments
- Format conversions (e.g. JPEG → PNG)

Two images are considered visually similar when their **Hamming distance** (the number of differing bits) is below a threshold.

:::note Visual duplicates need a perceptual hash first
The perceptual hash is computed while a photo is scanned, from its large thumbnail, and visual duplicate detection only looks at photos that already have one. Photos indexed before this feature was added have no hash, and an ordinary scan skips files it has already indexed — so **Detect Duplicates** can report no visual duplicates on an older library.

To fill in the missing hashes, run a **Rescan** once from the [Library page](./library.md#library-actions) — open the dropdown next to **Scan** and choose **Rescan**; this re-processes every photo. Exact-copy detection uses the file's MD5 hash and isn't affected.
:::

### Two-Pass Algorithm

For large collections, LibrePhotos uses a memory-efficient two-pass algorithm:

1. **Pass 1** — Photos are processed in batches (default 10,000). Within each batch, a BK-tree data structure enables fast Hamming distance lookups to find duplicates.

2. **Pass 2** — Cross-batch comparison ensures duplicates that span different batches are also found.

This approach keeps memory usage manageable even with hundreds of thousands of photos.

## Using Duplicate Detection

### Finding Duplicates

1. Navigate to **Organizing → Duplicate Photos**.
2. Open the **Detection Options** dropdown and choose what to look for. Do this *before* you start detection — the detect button runs immediately with whatever options are currently set:
   - **Exact file copies (identical content)** — find byte-identical files
   - **Visual duplicates (similar images)** — find visually similar photos
   - **Visual sensitivity** — Strict (fewer matches, higher confidence), Normal, or Loose (more matches, may include false positives). This only appears while *Visual duplicates* is enabled.
   - **Clear pending duplicates** — remove existing pending groups before detection runs
3. Click **"Detect Duplicates"**. Detection starts straight away using the options you selected.

The Detection Options aren't remembered between runs, so set them each time you detect. The default **Visual sensitivity** and **Clear pending duplicates** values come from **Settings → Duplicate Detection** and can be changed there; the *Exact file copies* and *Visual duplicates* checkboxes always start enabled.

Detection runs as a background job. You can monitor progress in the [Job System](./job-system.md).

### Reviewing Duplicates

Once detection is complete, duplicates appear as groups on the **Organizing → Duplicate Photos** page:

- Each group shows preview thumbnails of the duplicate photos
- Badges indicate the **type** (exact copy or visual duplicate) and **review status**
- **Potential savings** shows how much storage you'd free by keeping only one copy

#### Filtering Results

Use the filters at the top to narrow down results:

- **Status**: Pending Review, Resolved, Dismissed, or All
- **Type**: Exact Copies or Visual Duplicates

:::note
Dismissing a group unlinks its photos, which drops it below the two-photo minimum the list requires. As a result the **Dismissed** filter currently returns no groups, even though the **Dismissed (N)** tab still counts them.
:::

#### Resolving a Duplicate Group

Click on a duplicate group to open the review modal:

1. Each photo is shown with its **resolution**, **file size**, **camera**, **date**, and **file path**
2. The highest-resolution photo is automatically pre-selected as the one to keep
3. The pre-selected photo's button reads **"Keep This"**; every other photo shows a **"Select"** button. To keep a different photo, click its **"Select"** button — that photo's button then changes to **"Keep This"**
4. Click **"Keep Selected & Trash Others"** — the other photos are moved to trash
5. The group status changes to **Resolved**

#### Other Actions

- **"Not a Duplicate"** — Dismiss the group if the photos aren't actually duplicates. The group's status changes to **Dismissed** and its photos are unlinked from the group. Because the page only lists groups that still contain two or more photos, a dismissed group then disappears from view entirely — including from the **Dismissed** filter — even though it is still counted in the **Dismissed (N)** tab. This can't be undone from the interface.
- **"Revert & Restore Photos"** — For **resolved** groups only: undo the resolution, restore the trashed photos from the trash, and set the group back to **Pending**. Dismissed groups can't be reverted — the server rejects the request, and dismissing has already unlinked the photos rather than trashing them.
- **Delete Group** — Remove the duplicate group record entirely.

### Batch Operations

You can select multiple duplicate groups using the checkboxes and delete them in bulk.

## Tips

- **Start with exact copies** — These are guaranteed duplicates and safe to clean up
- **Review visual duplicates carefully** — Similar-looking photos from a burst sequence or different angles may not be true duplicates
- **Use strict sensitivity first** — Strict gives you high-confidence matches to review. A later run can still form new groups from photos that weren't matched, but visual detection skips any photo already in a visual-duplicate group, so a looser re-run won't add members to groups the strict run already created. To re-evaluate those photos, first clear their groups — enable **Clear pending duplicates** when you re-run (this deletes pending groups only; resolved groups are kept and their photos stay excluded), or delete the individual groups
- The **batch size** parameter can be tuned in the detection API for systems with limited memory (smaller batches use less RAM but take longer)
