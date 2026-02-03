# Generated migration to remove deprecated metadata fields from Photo model
# These fields have been migrated to PhotoMetadata model

from django.db import migrations


class Migration(migrations.Migration):
    """
    Remove deprecated metadata fields from Photo model.
    
    These fields have been migrated to the structured PhotoMetadata model:
    - camera -> PhotoMetadata.camera_model
    - lens -> PhotoMetadata.lens_model
    - fstop -> PhotoMetadata.aperture
    - shutter_speed -> PhotoMetadata.shutter_speed
    - iso -> PhotoMetadata.iso
    - focal_length -> PhotoMetadata.focal_length
    - focalLength35Equivalent -> PhotoMetadata.focal_length_35mm
    - width -> PhotoMetadata.width
    - height -> PhotoMetadata.height
    - digitalZoomRatio -> Not migrated (rarely used)
    - subjectDistance -> Not migrated (rarely used)
    
    Data was already copied in migration 0101_populate_photo_metadata.
    """

    dependencies = [
        ("api", "0102_photo_stacks_manytomany"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="photo",
            name="fstop",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="focal_length",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="iso",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="shutter_speed",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="camera",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="lens",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="width",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="height",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="focalLength35Equivalent",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="digitalZoomRatio",
        ),
        migrations.RemoveField(
            model_name="photo",
            name="subjectDistance",
        ),
    ]
