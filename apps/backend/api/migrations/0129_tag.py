"""Add the Tag model and seed it from the keywords already read out of EXIF.

Keyword import (IPTC:Keywords / XMP:Subject) has been writing into
``PhotoMetadata.keywords`` for a while. That JSON blob stays the source of
truth for what the file says; this migration projects it into real rows so
tags can be listed, renamed, merged and counted.
"""

import api.models.user
from django.conf import settings
from django.db import migrations, models
from django.db.models import Count


def create_tags_from_keywords(apps, schema_editor):
    Tag = apps.get_model("api", "Tag")
    PhotoMetadata = apps.get_model("api", "PhotoMetadata")
    TagPhotos = Tag.photos.through

    # Collect first, write afterwards: writing while a read cursor is still open
    # breaks SQLite (see the 0101 migration for the same lesson). Streaming the
    # rows keeps the peak memory proportional to the keywords, not the library.
    rows = (
        PhotoMetadata.objects.exclude(keywords__isnull=True)
        .values_list("photo_id", "photo__owner_id", "keywords")
        .iterator(chunk_size=2000)
    )

    photos_by_tag = {}
    for photo_id, owner_id, keywords in rows:
        if owner_id is None or not isinstance(keywords, list):
            continue
        for keyword in keywords:
            if not isinstance(keyword, str) or not keyword.strip():
                continue
            photos_by_tag.setdefault((keyword.strip(), owner_id), set()).add(photo_id)

    if not photos_by_tag:
        return

    Tag.objects.bulk_create(
        [Tag(name=name, owner_id=owner_id) for name, owner_id in photos_by_tag],
        ignore_conflicts=True,
    )
    tag_ids = {
        (name, owner_id): tag_id
        for tag_id, name, owner_id in Tag.objects.values_list("id", "name", "owner_id")
    }

    TagPhotos.objects.bulk_create(
        [
            TagPhotos(tag_id=tag_ids[key], photo_id=photo_id)
            for key, photo_ids in photos_by_tag.items()
            for photo_id in photo_ids
        ],
        ignore_conflicts=True,
    )

    visible_counts = {
        row["tag_id"]: row["count"]
        for row in TagPhotos.objects.filter(photo__hidden=False)
        .values("tag_id")
        .annotate(count=Count("photo_id"))
        .order_by()
    }
    tags = list(Tag.objects.filter(id__in=[tag_ids[key] for key in photos_by_tag]))
    for tag in tags:
        tag.photo_count = visible_counts.get(tag.id, 0)
    Tag.objects.bulk_update(tags, ["photo_count"])


def remove_tags_from_keywords(apps, schema_editor):
    """Drop the projection again. ``PhotoMetadata.keywords`` is untouched."""
    Tag = apps.get_model("api", "Tag")
    Tag.photos.through.objects.all().delete()
    Tag.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0128_emailconfig"),
    ]

    operations = [
        migrations.CreateModel(
            name="Tag",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.CharField(db_index=True, max_length=512)),
                ("photo_count", models.IntegerField(default=0)),
                (
                    "owner",
                    models.ForeignKey(
                        default=None,
                        on_delete=models.SET(api.models.user.get_deleted_user),
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "photos",
                    models.ManyToManyField(related_name="tags", to="api.photo"),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("name", "owner"), name="unique Tag")
                ],
            },
        ),
        migrations.RunPython(
            create_tags_from_keywords,
            remove_tags_from_keywords,
        ),
    ]
