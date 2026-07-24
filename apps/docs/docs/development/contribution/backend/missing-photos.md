---
title: "Missing Photos Implementation"
description: "Technical documentation for the missing photos feature"
sidebar_position: 4
---

## Overview

The missing photos feature in LibrePhotos handles cases where photo files become unavailable on the file system while their metadata remains in the database. This document explains the architecture, implementation details, and how the system handles missing photos.

## Architecture

### Data Models

#### File Model

Located in `apps/backend/api/models/file.py`, the `File` model represents individual files on disk:

```python
class File(models.Model):
    hash = models.CharField(primary_key=True, max_length=64)
    path = models.TextField(blank=True, default="", unique=True)
    type = models.PositiveIntegerField(choices=FILE_TYPES)
    missing = models.BooleanField(default=False)  # Tracks if file is missing
    embedded_media = models.ManyToManyField("self", symmetrical=False)
```

Key fields:
- `hash`: MD5 hash of file content + user ID (primary key)
- `path`: Full file system path. It carries `unique=True`, which is load-bearing here: `File.create` looks a file up by `path` and reuses the existing row instead of creating a duplicate when a file reappears.
- `missing`: Boolean flag indicating if the file cannot be found
- `type`: File type (IMAGE, VIDEO, METADATA_FILE, RAW_FILE, UNKNOWN)

#### Photo Model

Located in `apps/backend/api/models/photo.py`, the `Photo` model has relationships to files:

```python
class Photo(models.Model):
    # UUID primary key - enables flexible asset management
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Content hash for deduplication (MD5 of file content + user ID)
    image_hash = models.CharField(max_length=64, db_index=True)

    files = models.ManyToManyField(File)  # All associated files
    main_file = models.ForeignKey(
        File,
        related_name="main_photo",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )
    # ... other fields
```

The primary key is the UUID `id`, not `image_hash`. `image_hash` is an indexed but **non-unique** `CharField`: the database declares no `unique=True`, `unique_together`, or `UniqueConstraint` on it. Uniqueness per user is a property of how the hash is built (MD5 of content + the user's id), not a constraint the database enforces. Always look photos up as `Photo.objects.filter(image_hash=hash, owner=user)` — never `Photo.objects.get(pk=image_hash)`.

**A photo is considered missing when:**
- `files=None` (no associated files), OR
- `main_file=None` (no primary file reference)

Query for missing photos:
```python
missing_photos = Photo.objects.filter(
    Q(owner=user) & (Q(files=None) | Q(main_file=None))
)
```

The parentheses are load-bearing. Without them, Python's `&`-before-`|` precedence parses the filter as `(Q(owner=user) & Q(files=None)) | Q(main_file=None)`, which leaves the `main_file=None` branch unscoped and matches **every** user's photos — a cross-user data leak.

### Detection Mechanism

#### _check_files() Method

The `Photo._check_files()` method in `apps/backend/api/models/photo.py` is the core detection mechanism:

```python
def _check_files(self):
    for file in self.files.all():
        if not file.path or not os.path.exists(file.path):
            self.files.remove(file)  # Remove from photo's file list
            file.missing = True       # Mark file as missing
            file.save()
    self.save()
```

This method:
1. Iterates through all files associated with the photo
2. Checks if the file path exists on the file system
3. If missing, removes the file from the photo and sets `file.missing = True`
4. Saves changes to the database

Note that it removes a vanished file from `photo.files` but deliberately leaves `main_file` pointing at it — this matters for relinking (see [Relinking Process](#relinking-process)).

**When is this called?**
- Only during the `scan_missing_photos` job (`apps/backend/api/directory_watcher/scan_jobs.py`). This is the sole production call site.

The inverse — clearing the `missing` flag when a file reappears — is handled independently by `File.create` in `apps/backend/api/models/file.py`, not by `_check_files()`.

## Jobs

### Scan Missing Photos Job

**Type**: `JOB_SCAN_MISSING_PHOTOS` (job type 14)

**Function**: `scan_missing_photos(user, job_id)` in `apps/backend/api/directory_watcher/scan_jobs.py`

**Purpose**: Checks all photos owned by a user to detect missing files

**Implementation**:
```python
def scan_missing_photos(user, job_id: UUID):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_MISSING_PHOTOS,
        job_id=job_id,
    )
    try:
        existing_photos = Photo.objects.filter(owner=user.id).order_by("image_hash")

        paginator = Paginator(existing_photos, 5000)
        lrj.update_progress(current=0, target=paginator.num_pages)
        for page in range(1, paginator.num_pages + 1):
            # Allow the job to be cancelled from the UI between pages
            if is_job_cancelled(job_id):
                util.logger.info("Scan missing photos job cancelled")
                return
            for existing_photo in paginator.page(page).object_list:
                existing_photo._check_files()

            update_scan_counter(job_id)
    except Exception as e:
        util.logger.exception("An error occurred: ")
        lrj.fail(error=e)
```

**Key features**:
- Processes photos in batches of 5,000 to manage memory.
- Obtains the job via `LongRunningJob.get_or_create_job()` so an already-queued job row is reused and started rather than duplicated (`job_id` is unique).
- Reports progress via `lrj.update_progress(current, target)`, which persists the counters for UI feedback.
- Polls `is_job_cancelled(job_id)` (`apps/backend/api/directory_watcher/utils.py`) once per page, so the job can be cancelled from the UI mid-run.
- Any exception marks the job failed via `lrj.fail(error=e)`.
- Automatically triggered after full scans if not scanning specific files.

### Delete Missing Photos Job

**Type**: `JOB_DELETE_MISSING_PHOTOS` (job type 5)

**Function**: `delete_missing_photos(user, job_id)` in `apps/backend/api/autoalbum.py`

**Purpose**: Permanently removes missing photos and their associated data from the database

**Implementation**:
```python
def delete_missing_photos(user, job_id):
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_DELETE_MISSING_PHOTOS,
        job_id=job_id,
    )
    try:
        missing_pks = list(
            Photo.objects.filter(
                Q(owner=user) & (Q(files=None) | Q(main_file=None))
            ).values_list("pk", flat=True)
        )
        target = len(missing_pks)
        lrj.update_progress(current=0, target=target)

        # Delete in batches to bound peak memory. Album through-rows and Face
        # rows are removed by DB cascade on Photo.delete(); only AlbumThing
        # needs its photo_count / cover photos refreshed afterwards, because
        # cascade bypasses its m2m_changed receiver.
        affected_album_thing_ids: set[int] = set()
        for start in range(0, target, _DELETE_MISSING_BATCH_SIZE):
            batch_pks = missing_pks[start : start + _DELETE_MISSING_BATCH_SIZE]
            batch_qs = Photo.objects.filter(pk__in=batch_pks)
            affected_album_thing_ids.update(
                AlbumThing.objects.filter(photos__in=batch_qs).values_list(
                    "id", flat=True
                )
            )
            batch_qs.delete()
            lrj.update_progress(current=start + len(batch_pks), target=target)

        for album_thing in AlbumThing.objects.filter(id__in=affected_album_thing_ids):
            album_thing.photo_count = album_thing.photos.filter(hidden=False).count()
            album_thing.save(update_fields=["photo_count"])
            album_thing.update_default_cover_photo()

        # File.hash is `md5 + str(user.id)`, so the user's missing files are
        # identified by that suffix.
        File.objects.filter(
            Q(hash__endswith=str(user.id)) & Q(missing=True)
        ).delete()

        lrj.complete()
    except Exception as e:
        logger.exception("An error occurred")
        lrj.fail(error=e)
```

Notes on the implementation:
- The missing-photo query is parenthesised, so both OR branches are scoped to the requesting user.
- Photos are deleted in batches of `_DELETE_MISSING_BATCH_SIZE` (200) to bound peak memory.
- The file cleanup filter uses `str(user.id)`, because `File.hash` is `md5 + str(user.id)`. Passing the `User` instance would stringify to the username and match nothing.

**What gets deleted**:
- Photo records from database
- File records marked as missing
- Associations with date-based albums
- Associations with thing-based albums
- Associations with place-based albums
- Associations with user-created albums
- Face detections linked to the photos

Album associations and face detections are removed by database cascade on `Photo.delete()` (`Face.photo` is `on_delete=CASCADE`), not by explicit per-photo loops. `AlbumThing` is the one exception: its `photo_count` and cover photos are maintained by an `m2m_changed` receiver that cascade bypasses, so affected `AlbumThing` ids are snapshotted per batch and refreshed afterwards.

**What doesn't get deleted (TODO)**:
- Thumbnail files on disk (see [Known Issues and TODOs](#known-issues-and-todos)).

## API Endpoints

### Delete Missing Photos

**Endpoint**: `POST /api/deletemissingphotos`

**Implementation**: `DeleteMissingPhotosView` in `apps/backend/api/views/views.py`

```python
class DeleteMissingPhotosView(APIView):
    def post(self, request, format=None):
        return self._delete_missing_photos(request, format)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._delete_missing_photos(request, format)

    def _delete_missing_photos(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            AsyncTask(delete_missing_photos, request.user, job_id).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})
```

**Response**:
```json
{
  "status": true,
  "job_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

The deletion runs as a background django-q2 task (`AsyncTask(...).run()`), so the `200` is returned as soon as the task is queued — not when the sweep finishes. Track progress on the `LongRunningJob` identified by the returned `job_id` and poll it rather than treating the response as completion.

**Note**: Also supports GET (deprecated) for backward compatibility; both methods delegate to the same `_delete_missing_photos` helper.

### Photo Statistics

Missing photo count is included in the user statistics API response.

**Calculation**: `get_count_stats(user)` in `apps/backend/api/stats.py`

```python
num_missing_photos = Photo.objects.filter(
    Q(owner=user) & Q(files=None) | Q(main_file=None)
).count()
```

Returned in stats response as:
```json
{
  "num_photos": 1234,
  "num_missing_photos": 5,
  // ... other stats
}
```

:::note
Unlike `delete_missing_photos`, this count still uses the **unparenthesised** filter. Because of Python's `&`-before-`|` precedence it evaluates as `(Q(owner=user) & Q(files=None)) | Q(main_file=None)`, so `num_missing_photos` over-counts by including other users' photos that have `main_file=None`. This is a known bug in `stats.py`; the parenthesised, owner-scoped form used by `delete_missing_photos` is the correct one.
:::

## Hash-Based Relinking

### How It Works

When files reappear in the scanned directories, LibrePhotos reconnects them to their existing photo metadata rather than creating duplicate photos. A `File` is identified by a content hash (`File.hash` is `md5(content) + str(user.id)`, the primary key) and also carries a unique `path`, so a file that comes back is matched to the record it had before — even if it was renamed or moved within the scanned directories.

**Hash Calculation**: `calculate_hash(user, path)` in `apps/backend/api/models/file.py`

```python
def calculate_hash(user, path):
    hash_md5 = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(BUFFER_SIZE), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)
    # ... error handling
```

**Key points**:
- Hash is MD5 of file content + user ID
- User ID ensures photos are scoped to individual users in multi-user setups
- Buffer size of 65536 bytes for optimal performance

### Relinking Process

Relinking during a scan is driven by two independent pieces of the two-phase scan in `apps/backend/api/directory_watcher/`, not by a `Photo.image_hash` lookup:

1. **`File.create`** (`apps/backend/api/models/file.py`) looks a record up by its unique `path`. If the existing record is flagged `missing` while the file is back on disk, it clears the flag:

   ```python
   existing = File.objects.filter(path=path).first()
   if existing:
       if existing.missing and os.path.exists(path):
           existing.missing = False
           existing.save(update_fields=["missing"])
       return existing
   ```

2. **`group_files_into_photo`** (`apps/backend/api/directory_watcher/file_handlers.py`) re-adopts the original `Photo` instead of creating a new one:

   ```python
   existing_photo = Photo.objects.filter(
       Q(owner=user) & (Q(files__in=files) | Q(main_file__in=files))
   ).first()
   ```

   If a match is found, any files not already attached are added to it, and `main_file` is upgraded when a higher-priority variant appeared (per `FILE_TYPE_PRIORITY`). Only when no match exists is a new `Photo` created.

The `Q(main_file__in=files)` arm is the load-bearing part. `_check_files()` detaches a missing file from `photo.files` but leaves `main_file` pointing at it, so matching on `main_file` is what stops a reappearing file from spawning a duplicate `Photo` with the same `image_hash`.

:::note
`create_new_image` (`apps/backend/api/directory_watcher/file_handlers.py`) is the legacy single-file path, kept for uploads and the XMP-sidecar branch. It performs no `image_hash` lookup, no `removed`/`in_trashcan` restoration, and no `_check_files()` call — none of that relinking logic lives there any more. The behaviour above is exercised by `apps/backend/api/tests/test_missing_file_reappearance.py`.
:::

## Frontend Integration

### Photo Serializer

**File**: `apps/backend/api/serializers/photos.py`

`get_image_path` builds the list of file paths for a photo:

```python
def get_image_path(self, obj) -> list[str]:
    try:
        paths = []
        for file in obj.files.all():
            paths.append(file.path)
        return paths
    except Exception:
        return ["Missing"]
```

`Photo.files` is a `ManyToManyField(File)`, and `_check_files()` removes vanished files from that relation. A photo whose files have all gone missing therefore serializes `image_path` as an **empty list** `[]`. The `["Missing"]` value is only an error fallback for an unexpected exception — it is not the normal missing-photo signal.

The frontend detects the missing case by an empty array. `VersionComponent.tsx` and `routes/_protected/photo.$id.tsx` guard on `photoDetail.image_path && photoDetail.image_path.length > 0`, and `MediaDisplay.tsx` guards on `!photoDetails?.image_path || !Array.isArray(photoDetails.image_path)`.

### Video Error Handling

**File**: `apps/frontend/src/components/lightbox/VideoPlayer.tsx`

`MediaDisplay` builds the media URL (`/media/photos/<hash>.mp4` for videos, `/media/embedded_media/<hash>` for embedded media) and hands it to `VideoPlayer`. When the backend cannot serve the file, the `<video>` element's `onError` handler sets an error state and `VideoPlayer` renders a red alert over the still-available thumbnail poster, with a Retry button:

```tsx
if (error) {
  return (
    <div style={{ backgroundImage: posterUrl ? `url(${posterUrl})` : undefined, /* ... */ }}>
      <Alert color="red" title="Video Unavailable">
        <Text size="sm">The video file could not be loaded. It may be missing, unsupported, or unavailable.</Text>
        <Button variant="light" color="red" size="xs" mt="sm" onClick={handleRetry}>Retry</Button>
      </Alert>
    </div>
  );
}
```

### Settings UI

The user-facing entry point for deleting missing photos is on the Library settings page (`apps/frontend/src/components/settings/Library.tsx`, reached via the `/library` route):

- A red badge renders only when `countStats.num_missing_photos > 0` (from `useFetchCountStatsQuery`, i.e. the same `num_missing_photos` stat described in [Photo Statistics](#photo-statistics)). The badge label comes from the `settings.missingphotos` translation key ("Missing Photos"), and it sits inside a Mantine `HoverCard` whose dropdown (`settings.missingphotosdescription`) explains the feature.
- Clicking the badge opens a `Modal` titled `settings.missingphotosbutton` ("Remove missing photos") with Cancel / Confirm. Confirm calls `deleteMissingPhotos.mutate()` and then closes the modal.
- The mutation lives in `apps/frontend/src/api_client/photos/hooks/useDeleteMissingPhotosMutation.ts`. It `POST`s to `/deletemissingphotos` (the `/api` prefix comes from the fetch client base URL), validates the `{ status, job_id }` response with zod, and on success invalidates the auto-albums, date-albums, recently-added, count-stats, and photo-month-count query keys — worth knowing which cached views go stale after a delete.
- The same action is also exposed through the Spotlight command palette (`apps/frontend/src/components/spotlight/useSpotlightActions.ts`, action id `action-delete-missing`, label key `spotlight.actions.deleteMissing`). It fires the same mutation directly with no confirmation modal and is disabled when the worker queue cannot accept a job.

The English strings `settings.missingphotos`, `settings.missingphotosbutton`, and `settings.missingphotosdescription` live in `apps/frontend/src/locales/en/translation.json`; other locales come from Weblate.

## Future Implementation

### Real-Time File System Monitoring

**Goal**: Eliminate most missing photo cases through proactive file tracking

**Planned features**:

1. **File System Watchers**
   - Implement inotify (Linux), FSEvents (macOS), or watchdog library
   - Monitor scanned directories for file changes in real-time
   - Trigger immediate updates instead of waiting for manual scans

2. **Move/Rename Detection**
   - Detect when files are moved within scanned directories
   - Automatically update file paths in database
   - Preserve all metadata, ratings, and associations

3. **Immediate Relinking**
   - Hash-based matching happens immediately when files appear
   - No manual scan required
   - Significantly reduced "missing photo" window

4. **Benefits**
   - Near-instant UI updates when files change
   - Reduced database queries (no periodic scanning)
   - Better user experience with fewer missing photos
   - Lower system resource usage

### Implementation Considerations

- Performance impact of continuous monitoring
- Handling large directory trees efficiently
- Network storage compatibility (NAS, SMB, NFS)
- Docker container file system event propagation
- Graceful degradation if monitoring unavailable

## Known Issues and TODOs

### Current TODOs

1. **Remove thumbnails** (not implemented in `delete_missing_photos`)
   - `Thumbnail` rows are cascade-deleted with the `Photo` (`Thumbnail.photo` is a `OneToOneField(..., on_delete=CASCADE, primary_key=True)`), but the files on disk are left behind — there is no `post_delete` receiver for `Thumbnail`.
   - Orphaned files remain under `MEDIA_ROOT` (`$BASE_DATA/protected_media/`), named by `image_hash`, in:
     - `thumbnails_big/` (`.webp`)
     - `square_thumbnails/` (`.webp`, plus `.mp4` for video previews)
     - `square_thumbnails_small/` (`.webp`, plus `.mp4` for video previews)
   - Should be cleaned up to free disk space.

2. **Move delete_missing_photos function** (`autoalbum.py`)
   - The function carries a `# To-Do: This does not belong here` comment.
   - It should be moved to a more appropriate module (e.g. `photo_operations.py` or similar).

### Edge Cases

1. **Symbolic links**: May not be handled correctly in all cases
2. **Network storage timeouts**: Slow network storage may cause false positives
3. **Permissions**: Permission changes could make files appear missing
4. **Race conditions**: Files changed during scan may cause inconsistencies

## Code Organization

### Key Files

- **Models**:
  - `apps/backend/api/models/file.py` — `File` model (`missing` flag, unique `path`, `calculate_hash`)
  - `apps/backend/api/models/photo.py` — `Photo` model and `_check_files()` method
  - `apps/backend/api/models/long_running_job.py` — job type definitions
  - `apps/backend/api/models/thumbnail.py` — thumbnail records (cascade-deleted with the photo; files are not)

- **Business Logic**:
  - `apps/backend/api/directory_watcher/` — scanning and relinking (a package implementing the two-phase scan):
    - `scan_jobs.py` — `scan_photos`, `scan_missing_photos`
    - `file_handlers.py` — Phase 1 `create_file_record`, Phase 2 `group_files_into_photo`, legacy `create_new_image`
    - `file_grouping.py` — grouping key, `select_main_file`, `FILE_TYPE_PRIORITY`
    - `processing_jobs.py`, `repair_jobs.py`, `utils.py`
    - `__init__.py` re-exports the public names, so existing `from api.directory_watcher import ...` imports still work
  - `apps/backend/api/autoalbum.py` — `delete_missing_photos` function

- **API Views**:
  - `apps/backend/api/views/views.py` — delete missing photos endpoint
  - `apps/backend/api/views/photos.py` — photo operations

- **Statistics**:
  - `apps/backend/api/stats.py` — count calculations including missing photos

- **Serializers**:
  - `apps/backend/api/serializers/photos.py` — photo serialization (`get_image_path`)

- **Frontend**:
  - `apps/frontend/src/components/settings/Library.tsx` — missing-photos badge and confirmation modal
  - `apps/frontend/src/api_client/photos/hooks/useDeleteMissingPhotosMutation.ts` — `POST /deletemissingphotos` and cache invalidation
  - `apps/frontend/src/components/spotlight/useSpotlightActions.ts` — Spotlight "Delete Missing Photos" action
  - `apps/frontend/src/components/lightbox/VideoPlayer.tsx` — video load-error UI

- **Tests**:
  - `apps/backend/api/tests/test_delete_missing_photos.py`
  - `apps/backend/api/tests/test_missing_file_reappearance.py`

## Testing Considerations

When testing missing photos functionality:

1. **Setup**: Create photos with valid files
2. **Trigger**: Remove files from file system (outside LibrePhotos)
3. **Scan**: Run `scan_missing_photos` job
4. **Verify**: Check that photos marked as missing
5. **Restore**: Add files back and rescan
6. **Verify relinking**: Ensure photos automatically relink
7. **Delete**: Test permanent deletion with `delete_missing_photos`

### Automated tests

The behaviour above is covered by two test modules; extend them when changing this code:

- `apps/backend/api/tests/test_delete_missing_photos.py` — the `delete_missing_photos` sweep: per-user scoping of the `Q(owner=user) & (Q(files=None) | Q(main_file=None))` filter, the `hash__endswith=str(user.id)` missing-file filter, `LongRunningJob` progress reporting, batched processing, cascade cleanup of album through-rows, the single `AlbumThing.photo_count` / cover-photo refresh, and the `AsyncTask` wrap on the view.
- `apps/backend/api/tests/test_missing_file_reappearance.py` — clearing `File.missing` when a file returns to disk, and re-adoption of a reappearing file by its original `Photo` (no duplicate `Photo` created).

Run them from the backend app directory (normally inside the `backend` container — see [Development Install](../../dev-install.md)):

```bash
cd apps/backend
python manage.py test api.tests.test_delete_missing_photos api.tests.test_missing_file_reappearance
```

## Related Documentation

- [Missing Photos (User Guide)](../../../user-guide/missing-photos.md) - User-facing guide to identifying and resolving missing photos
- [Photo List Implementation](./photo-list.md) - Understanding photo queries and display
- [Thumbnails](./thumbnails.md) - How thumbnails are generated and stored
- [Upload System](./upload.md) - File handling during uploads
