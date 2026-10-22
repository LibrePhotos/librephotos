"""Sharing > Shared with you: places, things and people (#2721, #2722)."""

from __future__ import annotations

from rest_framework import serializers

from api.serializers.simple import SimpleUserSerializer


class SharedGroupCoverSerializer(serializers.Serializer[None]):
    image_hash = serializers.CharField()
    video = serializers.BooleanField()


class SharedGroupSerializer(serializers.Serializer[None]):
    """A place or thing of the photos shared with you, owners merged by title."""

    title = serializers.CharField()
    photo_count = serializers.IntegerField(
        help_text="The photos shared with you under this title"
    )
    cover_photos = SharedGroupCoverSerializer(
        many=True, help_text="Up to four of those photos, newest first"
    )


class SharedPersonSerializer(serializers.Serializer[None]):
    """A person the owner named, on photos they shared with you.

    One entry per owner and person: two owners' "Mom" are two entries. Only
    owners who share people's names (``share_people_names``) are listed.
    """

    id = serializers.IntegerField()
    name = serializers.CharField()
    owner = SimpleUserSerializer(help_text="Who named the person and shared the photos")
    photo_count = serializers.IntegerField(
        help_text="The photos shared with you that show this person"
    )
    face_url = serializers.CharField(
        allow_null=True,
        help_text="A face crop from one of those photos; null without one",
    )


class SharedGroupPhotosQuery(serializers.Serializer[None]):
    title = serializers.CharField(
        help_text="The place or thing, as the list names it", max_length=512
    )


class SharedPersonPhotosQuery(serializers.Serializer[None]):
    person = serializers.IntegerField(
        min_value=1, help_text="A person from the shared people list"
    )
