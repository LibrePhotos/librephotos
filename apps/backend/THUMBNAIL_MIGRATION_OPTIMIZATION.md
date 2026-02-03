# Thumbnail Migration Optimization

## Overview
This document explains the optimizations made to the thumbnail migration (`0120_rename_thumbnails_uuid_to_hash.py`) to improve performance for users with large photo collections.

## Problem
The original migration processed thumbnails one at a time:
- Loaded ALL thumbnails into memory at once
- Saved each thumbnail record individually to the database
- No progress reporting for long-running migrations

This approach was slow and memory-intensive for users with thousands or tens of thousands of photos.

## Solution
The optimized migration uses batch processing techniques:

### 1. **Iterator with Chunking**
```python
Thumbnail.objects.select_related('photo').only(...).iterator(chunk_size=BATCH_SIZE)
```
- Uses `iterator()` to stream results instead of loading all into memory
- Processes records in chunks of 1000 to reduce memory usage
- Only loads required fields with `only()` to minimize data transfer

### 2. **Batch Database Updates**
```python
Thumbnail.objects.bulk_update(
    thumbnails_to_update,
    ['thumbnail_big', 'square_thumbnail', 'square_thumbnail_small'],
    batch_size=BATCH_SIZE
)
```
- Accumulates thumbnail objects that need updating
- Uses `bulk_update()` to update 1000 records at once in a single query
- Dramatically reduces database round trips (1000x fewer queries)

### 3. **Progress Reporting**
```python
print(f"Progress: {processed_count}/{total_count} processed, {renamed_count} renamed, {skipped_count} skipped")
```
- Reports progress every 1000 records
- Shows total count at start so users know how long to wait
- Final summary shows complete statistics

## Performance Benefits

### Memory Usage
- **Before**: O(N) - All thumbnails loaded into memory
- **After**: O(BATCH_SIZE) - Only 1000 thumbnails in memory at a time

### Database Queries
- **Before**: N individual UPDATE queries (one per thumbnail)
- **After**: N/1000 batch UPDATE queries (1000 records per query)

### Example Performance
For a library with 100,000 photos:
- **Before**: 100,000 individual database queries
- **After**: ~100 batch queries (1000x improvement)
- **Memory**: ~1MB instead of ~100MB

## Implementation Details

### Batch Size Selection
- `BATCH_SIZE = 1000` is a good balance:
  - Small enough to avoid memory issues
  - Large enough to get batch performance benefits
  - Matches Django's default batch size recommendations

### Field Selection
The `only()` clause loads only needed fields:
- `photo_id`: Foreign key to Photo
- `photo__id`: Photo's UUID
- `photo__image_hash`: Photo's content hash
- `photo__video`: Video flag for file extension
- `thumbnail_big`, `square_thumbnail`, `square_thumbnail_small`: Fields to update

This reduces network/memory overhead by not loading unused fields.

### Error Handling
- Individual file rename errors are caught and logged
- Migration continues even if some files fail to rename
- Database is always updated to match filesystem state

## Testing
Tests are included in `api/tests/test_thumbnail_migration.py` to verify:
1. Batch processing logic
2. File renaming behavior
3. Bulk update performance

## Migration Safety
- Only renames files that exist
- Never overwrites existing files
- Idempotent (can be run multiple times safely)
- Database updates only happen after file renames succeed
