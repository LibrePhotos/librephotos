---
title: "📂 Missing Photos"
description: "Understanding and managing missing photos in LibrePhotos"
sidebar_position: 16
---

## What are Missing Photos?

Missing photos are photos whose metadata and thumbnails exist in LibrePhotos' database, but the actual image files cannot be found on your file system. This typically happens in two situations:

1. **Files moved or renamed externally** - When you move or rename files using a file manager, operating system tools, or other programs outside of LibrePhotos
2. **Storage or mounting issues** - When external drives aren't mounted, network storage is disconnected, or Docker mount points are misconfigured

## Why Does LibrePhotos Keep Missing Photos?

LibrePhotos deliberately keeps missing photos in the database instead of immediately deleting them. This is a design decision based on real-world usage patterns:

- **Files often come back** - In many cases, the files return when you remount a drive, fix storage configuration, or realize files were moved
- **Preservation of metadata** - Your ratings, captions, face tags, and album assignments are preserved
- **Automatic relinking** - When files reappear, LibrePhotos can automatically reconnect them to their metadata using hash-based matching

## When Photos Get Marked as Missing

LibrePhotos only marks photos as missing during its missing-file check. This check runs automatically as one of the final steps of a photo scan, but only when:

- the scan is a **full scan** (a rescan of your whole library), or
- the scan covers your configured scan directory without targeting a specific list of files.

It is therefore skipped for scans that only cover a specific set of files or a single subdirectory — such as an upload — unless that scan is a full scan. The check looks at your own photos, and for each one whose file can no longer be found on disk, it marks the photo as missing.

Simply opening, viewing, or downloading a photo whose file has gone does **not** mark it as missing — you will just get an error for that one photo. The missing-photo count only updates after a scan has run this check.

Common scenarios that cause missing photos:

- Moving photos to a different folder using a file manager
- Renaming photo files outside of LibrePhotos
- External hard drive not mounted at startup
- Network attached storage (NAS) disconnected
- Changed mount points in Docker configuration
- Cloud storage sync issues

## How to Identify Missing Photos

LibrePhotos gives you two ways to spot missing photos:

### Missing Photos Badge

Click your avatar in the top-right corner and select **Library**. If any of your photos are missing, a red **"N Missing Photos"** badge appears next to the **Photos** heading; it is hidden when the count is zero. Hover over the badge to read a short explanation of how LibrePhotos marks photos as missing.

:::caution
Clicking the badge opens the **Remove missing photos** confirmation dialog, which permanently deletes those photos from the database. Hover only, unless deletion is what you intend.
:::

### In the Photo Details View

A missing photo keeps its thumbnail, so it still appears normally in the timeline and albums. The difference only shows in the photo details view: because the file has been detached from the photo, the filename is shown as **"Unknown filename"** and the folder-path breadcrumb is hidden.

## Resolving Missing Photos

You have several options for dealing with missing photos:

### Option 1: Restore the Files

If you know where the files went:

1. Move or copy the files back to their original location
2. If you've moved them to a new location within your scanned directories, LibrePhotos can automatically relink them
3. Run a photo scan to update the database

### Option 2: Fix Storage Configuration

If the issue is related to mounting or storage:

1. Ensure external drives are properly mounted
2. Check Docker volume mounts in your configuration
3. Verify network storage is accessible
4. Restart LibrePhotos after fixing storage issues
5. Run a scan from the **Library** page (avatar menu → **Library** → **Scan Library** → **Scan**) so LibrePhotos re-checks and relinks the restored files

### Option 3: Automatic Relinking

LibrePhotos automatically relinks photos when files reappear:

- During regular photo scans, the system uses hash-based matching
- If a file with the same content hash appears anywhere in your scanned directories, it will be automatically linked to the existing photo metadata
- This works even if the file has been renamed or moved to a different folder

To trigger automatic relinking:

1. Click your avatar in the top-right corner and select **Library** (or press `Ctrl+K` and search for "Library")
2. In the **Scan Library** row, click **Scan** to perform a new scan (a full re-read of every file is available as **Rescan** in the dropdown next to it)
3. LibrePhotos will detect and relink matching files

### Option 4: Delete Missing Photos

If you're certain the files are permanently gone:

1. Open the **Library** page (avatar menu → **Library**)
2. Next to the **Photos** heading, click the red **"N Missing Photos"** badge — it only appears when your library actually has missing photos
3. In the **Remove missing photos** dialog, click **Confirm**
4. This will permanently remove all missing photos from the database, including:
   - Photo metadata and EXIF information
   - Thumbnails
   - Face detections
   - Album associations
   - Ratings and captions

The same action is also available from the Spotlight command palette (`Ctrl+K`) as **Delete Missing Photos**.

:::caution
Deleting missing photos is permanent. Make sure the files are truly gone and won't be restored before using this option.
:::

## Common Scenarios and Solutions

### Scenario: External Drive Not Mounted

**Problem**: Your external drive containing photos wasn't mounted when LibrePhotos started.

**Solution**:
1. Mount the external drive
2. Restart the LibrePhotos container to pick up the mounted drive
3. The photos should automatically become available again

### Scenario: Changed Docker Mount Points

**Problem**: You changed your Docker volume configuration and the photo paths no longer match.

**Solution**:
1. Update your Docker configuration to use the original mount point, or
2. Move your photos to match the new mount point
3. Restart LibrePhotos
4. Run a scan from the **Library** page to update the database

### Scenario: Files Moved to Different Folder

**Problem**: You reorganized your photo collection using a file manager.

**Solution**:
1. If the new location is within your scanned directories, just run a scan from the **Library** page (**Scan Library** → **Scan**)
2. LibrePhotos will detect the files by hash and automatically relink them
3. The original metadata, ratings, and face tags will be preserved

### Scenario: Deleted Files in Trash

**Problem**: Photos show as missing after moving them to trash.

**Solution**:
- If you want to keep them: Restore the files from trash and run a scan
- If you want to remove them: Use the **"N Missing Photos"** badge on the Library page (or the **Delete Missing Photos** action in the Spotlight palette) to clean up the database

## Future Improvements

LibrePhotos is working on implementing real-time file system monitoring that will:

- Automatically detect when files are moved or renamed
- Immediately update photo paths without manual scans
- Significantly reduce cases where photos are marked as missing
- Provide instant relinking when files are moved within scanned directories

This real-time monitoring will use file system watchers (inotify on Linux, FSEvents on macOS) to track changes as they happen, making the missing photos feature even more seamless.

## Related Documentation

- [Trash Management](./trash.md) - Learn about LibrePhotos' trash system
- [Job System](./job-system.md) - Understanding long-running jobs such as "Delete Missing Photos", and how to monitor them in the Admin Area
- [Auto Scan](./auto-scan.md) - Configure automatic photo scanning

