---
title: "🔍 Duplicate Detection"
excerpt: "Find and manage duplicate photos in your library"
sidebar_position: 8
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

### Two-Pass Algorithm

For large collections, LibrePhotos uses a memory-efficient two-pass algorithm:

1. **Pass 1** — Photos are processed in batches (default 10,000). Within each batch, a BK-tree data structure enables fast Hamming distance lookups to find duplicates.

2. **Pass 2** — Cross-batch comparison ensures duplicates that span different batches are also found.

This approach keeps memory usage manageable even with hundreds of thousands of photos.

## Using Duplicate Detection

### Finding Duplicates

1. Navigate to **Organizing → Duplicates**
2. Click **"Find Duplicates"**
3. Configure detection options:
   - **Exact copies** — Enable to find identical files
   - **Visual duplicates** — Enable to find visually similar photos
   - **Sensitivity** — Strict (fewer matches, higher confidence), Normal, or Loose (more matches, may include false positives)
   - **Clear pending** — Optionally clear previously pending results before running
4. Click **"Start Detection"**

Detection runs as a background job. You can monitor progress in the [Job System](./job-system.md).

### Reviewing Duplicates

Once detection is complete, duplicates appear as groups on the **Organizing → Duplicates** page:

- Each group shows preview thumbnails of the duplicate photos
- Badges indicate the **type** (exact copy or visual duplicate) and **review status**
- **Potential savings** shows how much storage you'd free by keeping only one copy

#### Filtering Results

Use the filters at the top to narrow down results:

- **Status**: Pending, Resolved, Dismissed, or All
- **Type**: Exact Copies or Visual Duplicates

#### Resolving a Duplicate Group

Click on a duplicate group to open the review modal:

1. Each photo is shown with its **resolution**, **file size**, **camera**, **date**, and **file path**
2. The highest-resolution photo is automatically pre-selected as the one to keep
3. Click **"Keep This"** on the photo you want to keep (or select a different one)
4. Click **"Keep Selected & Trash Others"** — the other photos are moved to trash
5. The group status changes to **Resolved**

#### Other Actions

- **"Not a Duplicate"** — Dismiss the group if the photos aren't actually duplicates. The status changes to **Dismissed**.
- **"Revert & Restore Photos"** — For resolved or dismissed groups, undo the action and restore any trashed photos.
- **Delete Group** — Remove the duplicate group record entirely.

### Batch Operations

You can select multiple duplicate groups using the checkboxes and delete them in bulk.

## Tips

- **Start with exact copies** — These are guaranteed duplicates and safe to clean up
- **Review visual duplicates carefully** — Similar-looking photos from a burst sequence or different angles may not be true duplicates
- **Use strict sensitivity first** — You can always run again with looser settings to find more
- The **batch size** parameter can be tuned in the detection API for systems with limited memory (smaller batches use less RAM but take longer)
