"""What the stack and duplicate views have in common in their answers.

Stacks (``api/views/stacks.py``) and duplicate groups
(``api/views/duplicates.py``) are both groups of photos, and their views build
the same row shapes by hand: a small thumbnail per photo in the list, a page
envelope with the legacy page flags, a photo row in the detail, and the answer
of deleting a group. Only for the OpenAPI schema; the views build the dicts.
"""

from rest_framework import serializers


class PhotoGroupThumbnailSerializer(serializers.Serializer[None]):
    """A photo of a group in its list row: the cover (kept) photo or one of the first four."""

    image_hash = serializers.CharField()
    thumbnail_url = serializers.CharField(
        allow_null=True,
        help_text="/media/square_thumbnails_small/<image_hash>; null without one",
    )


class LegacyFlagsPageSerializer(serializers.Serializer[None]):
    """The page envelope (``api/drf/pagination.py``) plus ``has_next``/``has_previous``
    (``with_legacy_page_flags``). A subclass adds ``results``."""

    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    num_pages = serializers.IntegerField()
    has_next = serializers.BooleanField(
        help_text="Deprecated, for web bundles up to 1.3: next is not null"
    )
    has_previous = serializers.BooleanField(
        help_text="Deprecated, for web bundles up to 1.3: previous is not null"
    )


class GroupPhotoSerializer(serializers.Serializer[None]):
    """The fields a photo row of a group's detail has in both kinds of group."""

    id = serializers.UUIDField()
    image_hash = serializers.CharField()
    width = serializers.IntegerField(allow_null=True)
    height = serializers.IntegerField(allow_null=True)
    size = serializers.IntegerField(help_text="Bytes")
    camera = serializers.CharField(allow_null=True)
    exif_timestamp = serializers.DateTimeField(allow_null=True)
    file_path = serializers.CharField(
        allow_null=True, help_text="The main file's path; null without one"
    )
    thumbnail_url = serializers.CharField(
        allow_null=True,
        help_text="/media/square_thumbnails_small/<image_hash>; null without one",
    )
    thumbnail_big_url = serializers.CharField(
        allow_null=True,
        help_text="/media/thumbnails_big/<image_hash>; null without one",
    )


class UnlinkGroupResponseSerializer(serializers.Serializer[None]):
    """Deleting a stack or a duplicate group: the group is gone, its photos stay."""

    status = serializers.CharField(help_text='Always "deleted"')
    unlinked_count = serializers.IntegerField(
        help_text="How many photos were in the group"
    )
