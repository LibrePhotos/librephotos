"""The custom date rule editor of the settings page and "Why this date?" on a
photo (#2272). The rules themselves are saved with the user
(``datetime_rules``, ``UserSerializer``)."""

import logging
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import ServiceUnavailable
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.metadata.date_rule_checks import (
    CONDITION_TAGS,
    DATE_TAGS,
    FIRST_CUSTOM_ID,
    rule_problems,
)
from api.metadata.datetime_rules import RuleOutcome
from api.metadata.photo_datetime import date_rule_outcomes
from api.metadata.reader import MetadataFileMissingError, MetadataReadError
from api.models import Photo
from api.serializers.date_rules import (
    APPLIES,
    ERROR,
    NOT_APPLICABLE,
    DateRuleCheckRequest,
    DateRuleCheckResponse,
    DateRuleOptionsResponse,
    DateRulesTestQuery,
    DateRulesTestResponse,
)

logger = logging.getLogger(__name__)


class DateRuleOptionsView(APIView):
    """The tags a custom date rule may read and check, and where custom rule
    ids start. Another tag cannot be saved."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=DateRuleOptionsResponse)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(
            {
                "date_tags": [{"name": tag.name, "utc": tag.utc} for tag in DATE_TAGS],
                "condition_tags": list(CONDITION_TAGS),
                "first_custom_id": FIRST_CUSTOM_ID,
            }
        )


class DateRuleCheckView(APIView):
    """Whether one date rule can be saved, as the settings save checks it.
    Each param that cannot is a 400 entry with the param as its field, so the
    rule form shows the message next to it. Nothing is saved."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=DateRuleCheckRequest, responses=DateRuleCheckResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        rule = parse_body(request, DateRuleCheckRequest)["rule"]
        problems = rule_problems(rule)
        if problems:
            raise ValidationError(problems, code="invalid_date_rule")
        return Response({"rule": rule})


def _outcome_body(outcome: RuleOutcome) -> dict[str, Any]:
    rule_id = outcome.params.get("id")
    name = outcome.params.get("name")
    found = outcome.found
    if outcome.error is not None:
        kind = ERROR
    else:
        kind = APPLIES if found else NOT_APPLICABLE
    return {
        "rule_id": rule_id
        if isinstance(rule_id, int) and not isinstance(rule_id, bool)
        else None,
        "name": name if isinstance(name, str) else "",
        "outcome": kind,
        "local_time": found.local_time if found else None,
        "utc_offset": found.utc_offset if found else None,
        "error": outcome.error,
    }


class DateRulesTestView(APIView):
    """What each of the requester's saved date rules reads from one of their
    photos now, and which one a scan takes the date from: "Why this date?".
    It runs the saved rules, not ones sent along, so it shows exactly what a
    scan would do; nothing is changed. Another user's photo is a 404."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(parameters=[DateRulesTestQuery], responses=DateRulesTestResponse)
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        photo_id = parse_query(request, DateRulesTestQuery)["photo_id"]
        try:
            photo = Photo.objects.select_related("main_file", "owner").get_owned(
                user, id=photo_id
            )
        except Photo.DoesNotExist as error:
            raise NotFound("No such photo.") from error
        try:
            outcomes = [_outcome_body(o) for o in date_rule_outcomes(photo)]
        except MetadataFileMissingError as error:
            raise NotFound(
                "The photo's file is not on disk.", code="file_missing"
            ) from error
        except MetadataReadError as error:
            logger.warning(
                "Could not read photo %s to test date rules: %s",
                photo.image_hash,
                error,
            )
            raise ServiceUnavailable(
                "The photo's metadata cannot be read now."
            ) from error
        winner = next(
            (index for index, o in enumerate(outcomes) if o["outcome"] == APPLIES), None
        )
        return Response(
            {
                "photo_id": photo.id,
                "exif_timestamp": photo.exif_timestamp,
                "date_set_by_user": photo.timestamp is not None,
                "winner": winner,
                "outcomes": outcomes,
            }
        )
