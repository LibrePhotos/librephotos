---
title: "📂 Missing Photos"
excerpt: "Understanding and managing missing photos in LibrePhotos"
sidebar_position: 8
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

LibrePhotos identifies missing photos during these operations:

- **Photo scans** - Running the "Scan for Missing Photos" job checks all photos in the database
- **File system scans** - Regular photo scans detect when previously indexed files are no longer present
- **Photo access** - When attempting to view or serve a photo whose file doesn't exist
- **File operations** - When LibrePhotos tries to access a file for processing

Common scenarios that cause missing photos:

- Moving photos to a different folder using a file manager
- Renaming photo files outside of LibrePhotos
- External hard drive not mounted at startup
- Network attached storage (NAS) disconnected
- Changed mount points in Docker configuration
- Cloud storage sync issues

## How to Identify Missing Photos

LibrePhotos provides several ways to identify missing photos:

### Statistics Dashboard

Navigate to your user statistics to see the count of missing photos. The statistics page displays `num_missing_photos` which shows how many photos in your library have missing files.

### Photo Labels

Photos with missing files are labeled with **["Missing"]** when viewed in the library or photo details.

### Admin Area

Administrators can view detailed statistics about missing photos across all users in the Admin Area.

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
5. Run "Scan for Missing Photos" job to detect restored files

### Option 3: Automatic Relinking

LibrePhotos automatically relinks photos when files reappear:

- During regular photo scans, the system uses hash-based matching
- If a file with the same content hash appears anywhere in your scanned directories, it will be automatically linked to the existing photo metadata
- This works even if the file has been renamed or moved to a different folder

To trigger automatic relinking:

1. Go to Settings → Library Management
2. Click "Scan Photos" to perform a new scan
3. LibrePhotos will detect and relink matching files

### Option 4: Delete Missing Photos

If you're certain the files are permanently gone:

1. Go to Settings → Library Management
2. Click "Delete Missing Photos"
3. This will permanently remove all missing photos from the database, including:
   - Photo metadata and EXIF information
   - Thumbnails
   - Face detections
   - Album associations
   - Ratings and captions

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
4. Run "Scan for Missing Photos" to update the database

### Scenario: Files Moved to Different Folder

**Problem**: You reorganized your photo collection using a file manager.

**Solution**:
1. If the new location is within your scanned directories, just run "Scan Photos"
2. LibrePhotos will detect the files by hash and automatically relink them
3. The original metadata, ratings, and face tags will be preserved

### Scenario: Deleted Files in Trash

**Problem**: Photos show as missing after moving them to trash.

**Solution**:
- If you want to keep them: Restore the files from trash and run a scan
- If you want to remove them: Use "Delete Missing Photos" to clean up the database

## Future Improvements

LibrePhotos is working on implementing real-time file system monitoring that will:

- Automatically detect when files are moved or renamed
- Immediately update photo paths without manual scans
- Significantly reduce cases where photos are marked as missing
- Provide instant relinking when files are moved within scanned directories

This real-time monitoring will use file system watchers (inotify on Linux, FSEvents on macOS) to track changes as they happen, making the missing photos feature even more seamless.

## Related Documentation

- [Trash Management](./trash.md) - Learn about LibrePhotos' trash system
- [Job System](./job-system.md) - Understanding long-running jobs like "Scan for Missing Photos"
- [Auto Scan](./auto-scan.md) - Configure automatic photo scanning

