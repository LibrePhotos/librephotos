"""One store per metadata field (#2252).

Capture date, location, rating and caption now live only on ``Photo`` /
``PhotoCaption``; the copies in ``PhotoMetadata`` were never kept in step with
them and are dropped, with ``MetadataFile`` and the ``raw_*`` columns, which
nothing ever wrote.

Before the columns go, edits made through the metadata API, which only ever
reached ``PhotoMetadata``, are carried over to the store the app reads:

* a rating PATCHed there becomes ``Photo.rating``;
* a caption PATCHed there becomes the lightbox caption
  (``captions_json["user_caption"]``) when that is empty, and is added to the
  search index.

Only fields with a ``MetadataEdit`` after the photo's last "revert all" count:
anything else in those columns is a snapshot (taken by 0101 or when the
metadata endpoint first created the row) or the file's own value, which the
scan already put in both stores. The file is not written to.

Reversing puts the columns back and fills date, location, rating and caption
from ``Photo`` / ``PhotoCaption``, which is what the metadata API showed from
them since this migration.
"""

from django.db import migrations
from django.db.models import OuterRef, Subquery
from django.utils import timezone

BATCH_SIZE = 500


def _carried_edits(MetadataEdit):
    """{photo_id: {"rating", "caption"}} of the fields to carry over.

    A field counts when a MetadataEdit of it is newer than the photo's last
    revert-all marker.
    """
    last_revert = {}
    latest = {}
    rows = MetadataEdit.objects.filter(
        field_name__in=("rating", "caption", "_all")
    ).values_list("photo_id", "field_name", "created_at")
    for photo_id, field_name, created_at in rows:
        if field_name == "_all":
            if photo_id not in last_revert or created_at > last_revert[photo_id]:
                last_revert[photo_id] = created_at
            continue
        key = (photo_id, field_name)
        if key not in latest or created_at > latest[key]:
            latest[key] = created_at
    carried = {}
    for (photo_id, field_name), created_at in latest.items():
        revert = last_revert.get(photo_id)
        if revert is None or created_at > revert:
            carried.setdefault(photo_id, set()).add(field_name)
    return carried


def carry_metadata_api_edits_over(apps, schema_editor):
    MetadataEdit = apps.get_model("api", "MetadataEdit")
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    Photo = apps.get_model("api", "Photo")
    PhotoCaption = apps.get_model("api", "PhotoCaption")
    PhotoSearch = apps.get_model("api", "PhotoSearch")

    carried = _carried_edits(MetadataEdit)
    if not carried:
        return
    now = timezone.now()
    # Read everything first: SQLite cannot write while a cursor is open.
    metadata_rows = list(
        PhotoMetadata.objects.filter(photo_id__in=list(carried)).values_list(
            "photo_id", "rating", "caption"
        )
    )
    for photo_id, rating, caption in metadata_rows:
        fields = carried[photo_id]
        if "rating" in fields and isinstance(rating, int):
            Photo.objects.filter(pk=photo_id).update(
                rating=max(0, min(rating, 5)), last_modified=now
            )
        if "caption" in fields and caption and caption.strip():
            _carry_caption(Photo, PhotoCaption, PhotoSearch, photo_id, caption.strip(), now)


def _carry_caption(Photo, PhotoCaption, PhotoSearch, photo_id, caption, now):
    caption_row, _ = PhotoCaption.objects.get_or_create(photo_id=photo_id)
    captions = dict(caption_row.captions_json or {})
    if (captions.get("user_caption") or "").strip():
        return
    captions["user_caption"] = caption
    caption_row.captions_json = captions
    caption_row.save(update_fields=["captions_json"])
    # The app reindexes a caption when it is saved; the historical model has
    # no such method, so the caption is appended to the index as is.
    search_row, _ = PhotoSearch.objects.get_or_create(photo_id=photo_id)
    search_row.search_captions = " ".join(
        part for part in (search_row.search_captions, caption) if part
    )
    search_row.save(update_fields=["search_captions"])
    Photo.objects.filter(pk=photo_id).update(last_modified=now)


def restore_metadata_columns(apps, schema_editor):
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    Photo = apps.get_model("api", "Photo")
    PhotoCaption = apps.get_model("api", "PhotoCaption")

    photo = Photo.objects.filter(pk=OuterRef("photo_id"))
    PhotoMetadata.objects.update(
        date_taken=Subquery(photo.values("exif_timestamp")[:1]),
        gps_latitude=Subquery(photo.values("exif_gps_lat")[:1]),
        gps_longitude=Subquery(photo.values("exif_gps_lon")[:1]),
        rating=Subquery(photo.values("rating")[:1]),
    )
    captions = {
        photo_id: (captions_json or {}).get("user_caption")
        for photo_id, captions_json in PhotoCaption.objects.values_list(
            "photo_id", "captions_json"
        )
    }
    rows = list(PhotoMetadata.objects.filter(photo_id__in=list(captions)))
    for row in rows:
        row.caption = captions.get(row.photo_id) or None
    PhotoMetadata.objects.bulk_update(rows, ["caption"], batch_size=BATCH_SIZE)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0154_metadata_edit_json_encoder'),
    ]

    operations = [
        migrations.RunPython(carry_metadata_api_edits_over, restore_metadata_columns),
        migrations.RemoveField(
            model_name='metadatafile',
            name='file',
        ),
        migrations.RemoveField(
            model_name='metadatafile',
            name='photo',
        ),
        migrations.RemoveIndex(
            model_name='photometadata',
            name='api_photome_date_ta_35e59b_idx',
        ),
        migrations.RemoveIndex(
            model_name='photometadata',
            name='api_photome_locatio_1ca8bb_idx',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='caption',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='date_taken',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='gps_latitude',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='gps_longitude',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='location_address',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='location_city',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='location_country',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='location_state',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='rating',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='raw_exif',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='raw_iptc',
        ),
        migrations.RemoveField(
            model_name='photometadata',
            name='raw_xmp',
        ),
        migrations.DeleteModel(
            name='MetadataFile',
        ),
    ]
