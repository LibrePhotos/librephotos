"""Where a photo's position came from, and which position its place is for (#2264).

``location_source``: a scan replaces a position read from the file when the
file changes and clears it when the file's GPS is gone, but never touches one
the user set. Existing rows stay NULL ("not known": replaced by the file's
position, never cleared), except photos whose latest location change was the
user's (a location edit not followed by "restore from file"), which get
"user".

``geocoded_lat/lon``: the position ``geolocation_json`` was looked up for.
The geolocation job picks up every photo whose position differs from it.
Photos whose place is current (``geolocation_json._v`` is the geocoder
version) get their position copied, so they are not looked up again.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import Exists, F, OuterRef

# api.geocode.GEOCODE_VERSION when this migration was written.
GEOCODE_VERSION = "1"
# api.metadata.edits.LOCATION and api.models.photo_metadata.REVERT_ALL.
LOCATION_EDIT = "location"
REVERT_ALL_EDIT = "_all"


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor | None) -> None:
    photo = apps.get_model("api", "Photo")
    metadata_edit = apps.get_model("api", "MetadataEdit")

    photo.objects.filter(
        exif_gps_lat__isnull=False,
        exif_gps_lon__isnull=False,
        geolocation_json___v=GEOCODE_VERSION,
    ).update(geocoded_lat=F("exif_gps_lat"), geocoded_lon=F("exif_gps_lon"))

    reverted_since = metadata_edit.objects.filter(
        photo_id=OuterRef("photo_id"),
        field_name=REVERT_ALL_EDIT,
        created_at__gt=OuterRef("created_at"),
    )
    user_location = metadata_edit.objects.filter(
        photo_id=OuterRef("pk"), field_name=LOCATION_EDIT
    ).filter(~Exists(reverted_since))
    photo.objects.filter(Exists(user_location)).update(location_source="user")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0165_photo_metadata_subject_distance_zoom"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="geocoded_lat",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="photo",
            name="geocoded_lon",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="photo",
            name="location_source",
            field=models.CharField(
                blank=True,
                choices=[("file", "File"), ("user", "User")],
                max_length=8,
                null=True,
            ),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
