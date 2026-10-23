"""Sharing a person with other users (#668)."""

from rest_framework import serializers

from api.drf.params import JsonBooleanField
from api.serializers.photo_groups import PhotoGroupPageSerializer
from api.serializers.photos import PhotoSummarySerializer
from api.serializers.simple import SimpleUserSerializer


class PersonSharingSerializer(serializers.Serializer[None]):
    """Who a person is shared with, what they see, and what waits for review."""

    recipients = SimpleUserSerializer(many=True)
    share_location = serializers.BooleanField()
    share_other_people = serializers.BooleanField()
    shared_count = serializers.IntegerField(
        help_text="Photos the recipients see: labelled and approved"
    )
    pending_count = serializers.IntegerField(
        help_text="Labelled photos that wait for your review"
    )


class PersonSharingRequest(serializers.Serializer[None]):
    """Share the person with exactly these users; absent switches are kept."""

    recipient_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), max_length=1000
    )
    share_location = JsonBooleanField(required=False)
    share_other_people = JsonBooleanField(required=False)


class PersonShareReviewRequest(serializers.Serializer[None]):
    """Photos of the person to show its recipients, and photos to keep back."""

    approve = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=10000
    )
    decline = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=10000
    )


class PersonSharePendingPageSerializer(PhotoGroupPageSerializer):
    """A page of the photos of a shared person that wait for review."""

    results = PhotoSummarySerializer(many=True)
