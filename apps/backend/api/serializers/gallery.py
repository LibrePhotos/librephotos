"""The public gallery (#434): its queries and answers.

What each answer carries, and what it never does, is ``api.sharing.gallery``'s
call; these only describe the shapes.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from api.models import Photo
from api.serializers.photos import PhotoSummarySerializer
from api.serializers.simple import SimpleUserSerializer
from api.sharing.gallery import GALLERY_SUMMARY_FIELDS
from api.sharing.grants import public_grant, redact, viewer_grant


class GalleryOwnerQuery(serializers.Serializer[None]):
    owner = serializers.IntegerField(
        required=False,
        min_value=1,
        help_text="Only this photographer's photos (a user id from the "
        "photographers list); another user's id matches nothing",
    )


class GalleryFilterQuery(GalleryOwnerQuery):
    place = serializers.CharField(
        default="",
        allow_blank=True,
        max_length=512,
        help_text="Only photos taken in this town, as the places list names it",
    )
    person = serializers.IntegerField(
        required=False,
        min_value=1,
        help_text="Only photos of this person, from the people list",
    )


class GalleryPhotosQuery(GalleryFilterQuery):
    day = serializers.IntegerField(
        min_value=1,
        help_text="A day's id from the day list (YYYYMMDD, or 1 for the "
        "photos without a date)",
    )


class GallerySerializer(serializers.Serializer[None]):
    """Whether the gallery is open and how much it shows."""

    stage = serializers.ChoiceField(
        choices=("members", "everyone"),
        help_text="Who may open it: signed-in users, or everyone",
    )
    indexable = serializers.BooleanField(
        help_text="Whether search engines may index it; noindex otherwise"
    )
    photo_count = serializers.IntegerField()
    photographer_count = serializers.IntegerField()


class GalleryDaySerializer(serializers.Serializer[None]):
    """A day of the gallery's timeline, or its group of undated photos."""

    id = serializers.IntegerField(
        help_text="YYYYMMDD; 1 for the photos without a date, listed last"
    )
    date = serializers.CharField(
        allow_null=True, help_text="The day (ISO date); null for the undated group"
    )
    location = serializers.CharField(
        help_text="The town, when every photo of the day is of an owner who "
        "shares places; empty otherwise"
    )
    photo_count = serializers.IntegerField()


class GalleryDayListSerializer(serializers.Serializer[None]):
    results = GalleryDaySerializer(many=True)


class GalleryPhotoSerializer(PhotoSummarySerializer):
    """A photo on a gallery list: what its owner shares on public pages, but
    never its coordinates or address (``GALLERY_SUMMARY_FIELDS``)."""

    def to_representation(self, instance: Photo) -> dict[str, Any]:
        data = super().to_representation(instance)
        grant = viewer_grant(self, instance.owner_id) or public_grant(None)
        redact(data, GALLERY_SUMMARY_FIELDS, grant)
        return data


class GalleryCoverSerializer(serializers.Serializer[None]):
    image_hash = serializers.CharField()
    video = serializers.BooleanField()


class GalleryPlaceSerializer(serializers.Serializer[None]):
    """A town of the photos of owners who share places, owners merged."""

    name = serializers.CharField()
    photo_count = serializers.IntegerField()
    owner_ids = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="The photographers with photos taken there",
    )
    cover_photos = GalleryCoverSerializer(many=True)


class GalleryPersonSerializer(serializers.Serializer[None]):
    """A person a photographer named, on their photos in the gallery.

    One entry per photographer and person: two photographers' "Mia" are two.
    """

    id = serializers.IntegerField()
    name = serializers.CharField()
    owner = SimpleUserSerializer(help_text="Whose photos and whose name it is")
    photo_count = serializers.IntegerField()
    face_url = serializers.CharField(
        allow_null=True, help_text="A face crop from one of those photos"
    )


class GalleryPhotographerSerializer(serializers.Serializer[None]):
    """A user who takes part, with photos in the gallery."""

    id = serializers.IntegerField()
    username = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    photo_count = serializers.IntegerField()
    cover_photos = GalleryCoverSerializer(many=True)


class GalleryPreviewSerializer(serializers.Serializer[None]):
    """What the gallery would show if it were open: for the admin's confirm."""

    photo_count = serializers.IntegerField()
    photographer_count = serializers.IntegerField()
    photographers = GalleryPhotographerSerializer(
        many=True, help_text="The photographers with the most photos, at most 20"
    )
