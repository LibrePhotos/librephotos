"""Reading a request's query string and body through a serializer.

A view never reads ``request.data`` or ``request.query_params`` field by field:
it declares a ``*Query`` or ``*Request`` serializer (``api/serializers/``) and
reads ``parse_query(request, XQuery)`` or ``parse_body(request, XRequest)``.
A missing or malformed field is then a 400 naming the field, never a 500 from
``int()`` or ``data["key"]``, and the same class goes into ``extend_schema``
(``parameters=[XQuery]``, ``request=XRequest``) so the schema cannot drift
from the parsing. ``RequestParsingGuardTest``
(``api/tests/infra/test_api_conventions.py``) enforces it.

The two fields below keep what clients already rely on: pagination numbers are
clamped rather than refused (the mobile sync asks for ``page_size=1000`` on
purpose), and query flags read the lenient way every view always read them.
"""

from collections.abc import Collection
from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.fields import empty
from rest_framework.request import Request

from api.request_data import request_dict


def parse_query(
    request: Request, serializer_class: type[serializers.Serializer[Any]]
) -> dict[str, Any]:
    """The query string validated by ``serializer_class``; 400 when it is not."""
    serializer = serializer_class(
        data=request.query_params, context={"request": request}
    )
    serializer.is_valid(raise_exception=True)
    return dict(serializer.validated_data)


def parse_body(
    request: Request, serializer_class: type[serializers.Serializer[Any]]
) -> dict[str, Any]:
    """The body validated by ``serializer_class``; 400 when it is not.

    A body that is not a JSON object is the usual ``parse_error`` from
    ``request_dict``. The serializer gets the request in its context, which
    ``OwnedPhotoField`` needs to scope photo ids to the requester.
    """
    serializer = serializer_class(
        data=request_dict(request), context={"request": request}
    )
    serializer.is_valid(raise_exception=True)
    return dict(serializer.validated_data)


class ClampedIntegerField(serializers.IntegerField):
    """An integer that is clamped into ``[lowest, highest]`` instead of refused.

    A value that is not a number at all is still a 400.
    """

    def __init__(
        self,
        *,
        default: int,
        lowest: int | None = None,
        highest: int | None = None,
        help_text: str | None = None,
    ) -> None:
        self.lowest = lowest
        self.highest = highest
        super().__init__(default=default, help_text=help_text)

    def to_internal_value(self, data: float | int | str) -> int:
        number = super().to_internal_value(data)
        if self.lowest is not None:
            number = max(self.lowest, number)
        if self.highest is not None:
            number = min(self.highest, number)
        return number


@extend_schema_field(OpenApiTypes.BOOL)
class QueryFlagField(serializers.Field[bool, str, bool, Any]):
    """A query-string flag, read leniently: it never fails.

    With ``true_values`` the flag is on only for those spellings (off when the
    parameter is absent); with ``false_values`` it is on unless spelled as one
    of them (on when absent). Values compare stripped and lower-cased.
    ``serializers.BooleanField`` would refuse unknown spellings and, on a
    query string, read an absent flag as false whatever its default.
    """

    def __init__(
        self,
        *,
        true_values: Collection[str] | None = None,
        false_values: Collection[str] | None = None,
        help_text: str | None = None,
    ) -> None:
        if (true_values is None) == (false_values is None):
            raise ValueError("Give exactly one of true_values and false_values.")
        self.true_values = frozenset(true_values or ())
        self.false_values = frozenset(false_values or ())
        super().__init__(default=false_values is not None, help_text=help_text)

    def to_internal_value(self, data: str) -> bool:
        text = str(data).strip().lower()
        if self.true_values:
            return text in self.true_values
        return text not in self.false_values

    def to_representation(self, value: bool) -> bool:
        return value


class JsonBooleanField(serializers.BooleanField):
    """A JSON ``true``/``false`` only: ``"false"``, ``"true"`` or ``1`` are a 400.

    For bodies whose endpoints never read a flag by truthiness or spelling
    (``serializers.BooleanField`` takes ``"yes"``, ``"on"``, ``1``, ...). An
    absent field stays absent on a form body too, where ``BooleanField`` would
    read it as an unchecked box (false).
    """

    default_empty_html = empty

    def to_internal_value(self, data: str | bool | int) -> bool:
        if not isinstance(data, bool):
            self.fail("invalid", input=data)
        return data


class JsonStringField(serializers.CharField):
    """A JSON string kept as sent: blank allowed, whitespace not trimmed.

    ``serializers.CharField`` would turn a number into a string and strip it.
    """

    def __init__(self, *, required: bool = True, help_text: str | None = None) -> None:
        super().__init__(
            required=required,
            allow_blank=True,
            trim_whitespace=False,
            help_text=help_text,
        )

    def to_internal_value(self, data: str) -> str:
        if not isinstance(data, str):
            self.fail("invalid")
        return data


class JsonIntegerField(serializers.IntegerField):
    """A JSON integer only: ``"3"``, ``3.5`` or ``true`` are a 400.

    ``serializers.IntegerField`` takes numeric strings and whole floats, and
    reads nothing else into a number; ``true`` must not mean one star.
    """

    def to_internal_value(self, data: float | int | str) -> int:
        if isinstance(data, bool) or not isinstance(data, int):
            self.fail("invalid")
        return super().to_internal_value(data)
