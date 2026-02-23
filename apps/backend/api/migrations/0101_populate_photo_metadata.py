# Generated migration to populate PhotoMetadata from existing Photo data

from django.db import migrations, transaction
from django.db.models import Exists, OuterRef


BATCH_SIZE = 1000


def populate_photo_metadata(apps, schema_editor):
    """
    Populate PhotoMetadata for all existing photos.

    This copies metadata fields from Photo model to the structured PhotoMetadata model.
    PhotoMetadata provides:
    - Normalized field names
    - Edit history tracking
    - XMP sidecar support
    - Better organization of camera/lens/settings

    Optimized for SQLite and PostgreSQL compatibility:
    - Fetches all photo IDs upfront (avoids open cursor + writes conflict on SQLite)
    - Loads caption data per-batch to avoid memory issues
    - Processes in batches with per-batch transactions (no huge outer transaction)
    """
    Photo = apps.get_model("api", "Photo")
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    PhotoCaption = apps.get_model("api", "PhotoCaption")

    # Exists subquery for efficient filtering
    existing_metadata = PhotoMetadata.objects.filter(photo_id=OuterRef('pk'))

    # Collect all photo IDs that need metadata upfront.
    # Using values_list avoids keeping a cursor open while we write below,
    # which can cause SQLite "database is locked" / cursor-state issues.
    photo_ids = list(
        Photo.objects
        .filter(~Exists(existing_metadata))
        .values_list('pk', flat=True)
    )

    total_count = len(photo_ids)
    if total_count == 0:
        print("No photos need metadata population.")
        return

    print(f"Populating metadata for {total_count} photos...")

    processed = 0

    for i in range(0, total_count, BATCH_SIZE):
        chunk_ids = photo_ids[i:i + BATCH_SIZE]

        # Load caption data for this chunk only
        captions = {
            c.photo_id: c.captions_json
            for c in PhotoCaption.objects.filter(photo_id__in=chunk_ids)
        }

        batch = []
        for photo in Photo.objects.filter(pk__in=chunk_ids):
            captions_json = captions.get(photo.pk)
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

        with transaction.atomic():
            PhotoMetadata.objects.bulk_create(batch, ignore_conflicts=True)
        processed += len(batch)
        print(f"  Processed {processed}/{total_count} photos ({100*processed//total_count}%)")

    print(f"Completed populating metadata for {processed} photos.")


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
        migrations.RunPython(
            populate_photo_metadata,
            reverse_populate,
            atomic=False,
        ),
    ]
