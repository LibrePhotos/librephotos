---
title: "Missing Photos Implementation"
excerpt: "Technical documentation for the missing photos feature"
category: 5
---

## Overview

The missing photos feature in LibrePhotos handles cases where photo files become unavailable on the file system while their metadata remains in the database. This document explains the architecture, implementation details, and how the system handles missing photos.

## Architecture

### Data Models

#### File Model

Located in `librephotos/api/models/file.py`, the `File` model represents individual files on disk:

```python
class File(models.Model):
    hash = models.CharField(primary_key=True, max_length=64)
    path = models.TextField(blank=True, default="")
    type = models.PositiveIntegerField(choices=FILE_TYPES)
    missing = models.BooleanField(default=False)  # Tracks if file is missing
    embedded_media = models.ManyToManyField("File")
```

Key fields:
- `hash`: MD5 hash of file content + user ID (primary key)
- `path`: Full file system path
- `missing`: Boolean flag indicating if the file cannot be found
- `type`: File type (IMAGE, VIDEO, METADATA_FILE, RAW_FILE, UNKNOWN)

#### Photo Model

Located in `librephotos/api/models/photo.py`, the `Photo` model has relationships to files:

```python
class Photo(models.Model):
    image_hash = models.CharField(primary_key=True, max_length=64)
    files = models.ManyToManyField(File)  # All associated files
    main_file = models.ForeignKey(
        File,
        related_name="main_photo",
        on_delete=models.SET_NULL,
        null=True,
    )
    # ... other fields
```

**A photo is considered missing when:**
- `files=None` (no associated files), OR
- `main_file=None` (no primary file reference)

Query for missing photos:
```python
missing_photos = Photo.objects.filter(
    Q(owner=user) & Q(files=None) | Q(main_file=None)
)
```

### Detection Mechanism

#### _check_files() Method

The `Photo._check_files()` method (lines 508-514 in `librephotos/api/models/photo.py`) is the core detection mechanism:

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

**When is this called?**
- During photo scans (`scan_missing_photos` job)
- When adding new files to existing photos
- After detecting duplicate photos during import

## Jobs

### Scan Missing Photos Job

**Type**: `JOB_SCAN_MISSING_PHOTOS` (job type 14)

**Function**: `scan_missing_photos(user, job_id)` in `librephotos/api/directory_watcher.py:356-386`

**Purpose**: Checks all photos owned by a user to detect missing files

**Implementation**:
```python
def scan_missing_photos(user, job_id: UUID):
    # Create or update job entry
    lrj = LongRunningJob.objects.create(
        started_by=user,
        job_id=job_id,
        job_type=LongRunningJob.JOB_SCAN_MISSING_PHOTOS,
    )
    
    # Get all photos for user
    existing_photos = Photo.objects.filter(owner=user.id).order_by("image_hash")
    
    # Process in batches of 5000 for memory efficiency
    paginator = Paginator(existing_photos, 5000)
    lrj.progress_target = paginator.num_pages
    
    for page in range(1, paginator.num_pages + 1):
        for existing_photo in paginator.page(page).object_list:
            existing_photo._check_files()  # Check each photo's files
        update_scan_counter(job_id)
```

**Key features**:
- Processes photos in batches of 5,000 to manage memory
- Updates progress counter for UI feedback
- Automatically triggered after full scans if not scanning specific files

### Delete Missing Photos Job

**Type**: `JOB_DELETE_MISSING_PHOTOS` (job type 5)

**Function**: `delete_missing_photos(user, job_id)` in `librephotos/api/autoalbum.py:188-232`

**Purpose**: Permanently removes missing photos and their associated data from the database

**Implementation**:
```python
def delete_missing_photos(user, job_id):
    # Find all photos with no files or no main file
    missing_photos = Photo.objects.filter(
        Q(owner=user) & Q(files=None) | Q(main_file=None)
    )
    
    # Remove from all album types
    for missing_photo in missing_photos:
        album_dates = AlbumDate.objects.filter(photos=missing_photo)
        for album_date in album_dates:
            album_date.photos.remove(missing_photo)
        
        album_things = AlbumThing.objects.filter(photos=missing_photo)
        for album_thing in album_things:
            album_thing.photos.remove(missing_photo)
        
        album_places = AlbumPlace.objects.filter(photos=missing_photo)
        for album_place in album_places:
            album_place.photos.remove(missing_photo)
        
        album_users = AlbumUser.objects.filter(photos=missing_photo)
        for album_user in album_users:
            album_user.photos.remove(missing_photo)
        
        # Delete associated faces
        faces = Face.objects.filter(photo=missing_photo)
        faces.delete()
    
    # Delete the photos
    missing_photos.delete()
    
    # Delete missing file records
    missing_files = File.objects.filter(Q(hash__endswith=user) & Q(missing=True))
    missing_files.delete()
```

**What gets deleted**:
- Photo records from database
- File records marked as missing
- Associations with date-based albums
- Associations with thing-based albums
- Associations with place-based albums
- Associations with user-created albums
- Face detections linked to the photos

**What doesn't get deleted (TODO)**:
- Thumbnail files (line 221 notes: "To-Do: Remove thumbnails")

## API Endpoints

### Delete Missing Photos

**Endpoint**: `POST /api/deletemissingphotos`

**Implementation**: `DeleteMissingPhotosView` in `librephotos/api/views/views.py:433-451`

```python
class DeleteMissingPhotosView(APIView):
    def post(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            delete_missing_photos(request.user, job_id)
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

**Note**: Also supports GET method (deprecated) for backward compatibility.

### Photo Statistics

Missing photo count is included in the user statistics API response.

**Calculation**: `get_count_stats(user)` in `librephotos/api/stats.py:382-384`

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

## Hash-Based Relinking

### How It Works

When files reappear in the scanned directories (even with different names or paths), LibrePhotos can automatically relink them using hash-based matching.

**Hash Calculation**: `calculate_hash(user, path)` in `librephotos/api/models/file.py:136-145`

```python
def calculate_hash(user, path):
    hash_md5 = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(BUFFER_SIZE), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest() + str(user.id)
```

**Key points**:
- Hash is MD5 of file content + user ID
- User ID ensures photos are scoped to individual users in multi-user setups
- Buffer size of 65536 bytes for optimal performance

### Relinking Process

**Function**: `create_new_image(user, path)` in `librephotos/api/directory_watcher.py:62-136`

```python
def create_new_image(user, path) -> Photo | None:
    # Calculate hash for the file
    hash = calculate_hash(user, path)
    
    # Check if photo with this hash already exists
    photos: QuerySet[Photo] = Photo.objects.filter(image_hash=hash, owner=user)
    
    if not photos.exists():
        # Create new photo
        photo = Photo()
        photo.image_hash = hash
        # ... initialize photo
    else:
        # Photo exists - add this file to it (relinking)
        file = File.create(path, user)
        photo = photos.first()
        photo.files.add(file)
        
        # Restore if previously marked as removed
        if photo.removed:
            photo.removed = False
            photo.in_trashcan = False
        
        photo.save()
        photo._check_files()  # Verify all files still exist
        
    return photo
```

**Relinking behavior**:
1. Calculate hash of discovered file
2. Query for existing photos with same hash
3. If found, add new file to existing photo
4. Restore photo if it was marked as removed
5. Run `_check_files()` to clean up any still-missing files

## Frontend Integration

### Photo Serializer

**File**: `librephotos/api/serializers/photos.py:348`

The serializer includes a "Missing" label for photos without files:

```python
def get_image_path(self, obj) -> list[str]:
    if not obj.files or obj.files.count() == 0:
        return ["Missing"]
    return [file.path for file in obj.files.all()]
```

This ensures the frontend can display appropriate UI for missing photos.

### Video Error Handling

**File**: `librephotos-frontend/src/components/lightbox/MediaDisplay.tsx:64-69`

The frontend displays an error alert when video files are missing:

```tsx
if (videoError) {
  return (
    <Alert color="red" title="Video Not Found">
      <Text>The video file could not be found or is no longer available.</Text>
    </Alert>
  );
}
```

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

1. **Remove thumbnails** (line 221 in `autoalbum.py`)
   - When deleting missing photos, thumbnail files are not removed
   - Thumbnails remain in `data/thumbnails/` directory
   - Should be cleaned up to free disk space

2. **Move delete_missing_photos function** (line 187 in `autoalbum.py`)
   - Currently in `autoalbum.py` but doesn't belong there
   - Should be moved to appropriate module (e.g., `photo_operations.py` or similar)
   - Comment says: "To-Do: This does not belong here"

### Edge Cases

1. **Symbolic links**: May not be handled correctly in all cases
2. **Network storage timeouts**: Slow network storage may cause false positives
3. **Permissions**: Permission changes could make files appear missing
4. **Race conditions**: Files changed during scan may cause inconsistencies

## Code Organization

### Key Files

- **Models**:
  - `librephotos/api/models/file.py` - File model with missing flag
  - `librephotos/api/models/photo.py` - Photo model and `_check_files()` method
  - `librephotos/api/models/long_running_job.py` - Job type definitions

- **Business Logic**:
  - `librephotos/api/directory_watcher.py` - Scanning and relinking logic
  - `librephotos/api/autoalbum.py` - Delete missing photos function

- **API Views**:
  - `librephotos/api/views/views.py` - Delete missing photos endpoint
  - `librephotos/api/views/photos.py` - Photo operations

- **Statistics**:
  - `librephotos/api/stats.py` - Count calculations including missing photos

- **Serializers**:
  - `librephotos/api/serializers/photos.py` - Photo serialization with "Missing" label

## Testing Considerations

When testing missing photos functionality:

1. **Setup**: Create photos with valid files
2. **Trigger**: Remove files from file system (outside LibrePhotos)
3. **Scan**: Run `scan_missing_photos` job
4. **Verify**: Check that photos marked as missing
5. **Restore**: Add files back and rescan
6. **Verify relinking**: Ensure photos automatically relink
7. **Delete**: Test permanent deletion with `delete_missing_photos`

## Related Documentation

- [Photo List Implementation](./photo-list.md) - Understanding photo queries and display
- [Thumbnails](./thumbnails.md) - How thumbnails are generated and stored
- [Upload System](./upload.md) - File handling during uploads

