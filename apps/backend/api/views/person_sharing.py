"""Sharing a person with other users (#668): the owner's side.

Only the person's owner reaches these routes; another user's person, or a
face group that was never named, is a 404. The recipients' side is the
"Shared with you" people list (``api/faces/recipients.py``), which now also
lists the people shared with them.
"""

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.pagination import PAGE_PARAMETERS, PaginatedViewMixin
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.faces import person_shares
from api.models import Person, User
from api.serializers.person_sharing import (
    PersonSharePendingPageSerializer,
    PersonShareReviewRequest,
    PersonSharingRequest,
    PersonSharingSerializer,
)
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.serializers.simple import SimpleUserSerializer


def _sharing(person: Person) -> dict[str, Any]:
    recipients = User.objects.filter(received_person_shares__person=person).order_by(
        "username"
    )
    # The shape PersonSharingSerializer documents.
    return {
        "recipients": SimpleUserSerializer(recipients, many=True).data,
        "share_location": person.share_location,
        "share_other_people": person.share_other_people,
        "shared_count": person_shares.approved_photos(person).count(),
        "pending_count": person_shares.pending_photos(person).count(),
    }


class PersonSharingView(APIView):
    """Who one of your people is shared with, and what they see."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        operation_id="api_persons_sharing_retrieve",
        responses=PersonSharingSerializer,
    )
    def get(self, request: Request, person_id: int) -> Response:
        person = person_shares.owned_person(request_user(request), person_id)
        return Response(_sharing(person))

    @extend_schema(request=PersonSharingRequest, responses=PersonSharingSerializer)
    def put(self, request: Request, person_id: int) -> Response:
        """Share the person with exactly ``recipient_ids`` (none unshares).

        Sharing a person nobody had before shows them the photos you labelled
        with it now; later ones wait for your review.
        """
        person = person_shares.owned_person(request_user(request), person_id)
        data = parse_body(request, PersonSharingRequest)
        person_shares.set_recipients(person, data["recipient_ids"], data)
        person.refresh_from_db()
        return Response(_sharing(person))


class PersonSharingPendingView(PaginatedViewMixin, APIView):
    """The photos of one of your shared people that wait for your review."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        operation_id="api_persons_sharing_pending_list",
        parameters=PAGE_PARAMETERS,
        responses=PersonSharePendingPageSerializer,
    )
    def get(self, request: Request, person_id: int) -> Response:
        person = person_shares.owned_person(request_user(request), person_id)
        photos = with_photo_summary_relations(person_shares.pending_photos(person))
        page = self.paginate_queryset(photos)
        data = PhotoSummarySerializer(
            page, many=True, context={"request": request}
        ).data
        return self.get_paginated_response(data)


class PersonSharingReviewView(APIView):
    """Show photos of one of your shared people to its recipients, or keep
    them back. Ids of photos not labelled with the person are ignored."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PersonShareReviewRequest, responses=PersonSharingSerializer)
    def post(self, request: Request, person_id: int) -> Response:
        person = person_shares.owned_person(request_user(request), person_id)
        data = parse_body(request, PersonShareReviewRequest)
        person_shares.review(person, data["approve"], data["decline"])
        return Response(_sharing(person))
