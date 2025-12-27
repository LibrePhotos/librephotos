# Generated migration to populate PhotoMetadata from existing Photo data

from django.db import migrations


def populate_photo_metadata(apps, schema_editor):
    """
    Populate PhotoMetadata for all existing photos.
    
    This copies metadata fields from Photo model to the structured PhotoMetadata model.
    PhotoMetadata provides:
    - Normalized field names
    - Edit history tracking
    - XMP sidecar support
    - Better organization of camera/lens/settings
    """
    Photo = apps.get_model("api", "Photo")
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    PhotoCaption = apps.get_model("api", "PhotoCaption")
    
    # Build a lookup dict for captions (captions_json was moved to PhotoCaption in migration 0080)
    caption_lookup = {}
    for caption in PhotoCaption.objects.all().iterator(chunk_size=1000):
        caption_lookup[caption.photo_id] = caption.captions_json
    
    # Get photos that don't have metadata yet
    existing_metadata_photo_ids = PhotoMetadata.objects.values_list("photo_id", flat=True)
    photos = Photo.objects.exclude(id__in=existing_metadata_photo_ids).iterator(chunk_size=1000)
    
    batch = []
    for photo in photos:
        # Get caption data from PhotoCaption model
        captions_json = caption_lookup.get(photo.image_hash)
        
        metadata = PhotoMetadata(
            photo=photo,
            # Camera info
            camera_make=None,  # Not stored in Photo model separately
            camera_model=photo.camera,
            lens_make=None,  # Not stored separately
            lens_model=photo.lens,
            # Capture settings
            aperture=photo.fstop,
            shutter_speed=photo.shutter_speed,
            iso=photo.iso,
            focal_length=photo.focal_length,
            focal_length_35mm=photo.focalLength35Equivalent,
            # Image properties
            width=photo.width,
            height=photo.height,
            # Date/time
            date_taken=photo.exif_timestamp,
            # GPS
            gps_latitude=photo.exif_gps_lat,
            gps_longitude=photo.exif_gps_lon,
            # Content
            title=None,  # Photo doesn't have separate title
            caption=captions_json.get("user_caption") if captions_json else None,
            keywords=list(captions_json.get("keywords", [])) if captions_json else [],
            rating=photo.rating,
            # Source
            source="embedded",  # All existing data came from EXIF
            version=1,
        )
        batch.append(metadata)
        
        if len(batch) >= 1000:
            PhotoMetadata.objects.bulk_create(batch, ignore_conflicts=True)
            batch = []
    
    # Create remaining
    if batch:
        PhotoMetadata.objects.bulk_create(batch, ignore_conflicts=True)


def reverse_populate(apps, schema_editor):
    """
    Reverse migration - delete PhotoMetadata records.
    Note: This will lose any user edits made through PhotoMetadata.
    """
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    PhotoMetadata.objects.all().delete()


class Migration(migrations.Migration):
    """
    Data migration to populate PhotoMetadata from existing Photo data.
    
    This ensures backwards compatibility:
    - Photo model still has all the original fields
    - PhotoMetadata provides structured access + edit history
    - API can read from either, preferring PhotoMetadata when available
    """

    dependencies = [
        ("api", "0100_metadataedit_metadatafile_photometadata_stackreview_and_more"),
    ]

    operations = [
        migrations.RunPython(populate_photo_metadata, reverse_populate),
    ]
