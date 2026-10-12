"""``api/drf/params.py``: request input read through serializers (#2326)."""

from urllib.parse import urlencode

from django.http import QueryDict
from django.test import SimpleTestCase
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from api.drf.params import (
    ClampedIntegerField,
    QueryFlagField,
    TristateFlagField,
    parse_body,
    parse_query,
)


class ListQuery(serializers.Serializer[None]):
    page = ClampedIntegerField(default=1, lowest=1)
    page_size = ClampedIntegerField(default=20, lowest=1, highest=100)
    mine = QueryFlagField(true_values={"true"})
    fallback = QueryFlagField(false_values={"false", "0"})
    name = serializers.CharField(required=False)


class ThingRequest(serializers.Serializer[None]):
    count = serializers.IntegerField()
    enabled = serializers.BooleanField(default=False)


class EchoView(APIView):
    permission_classes = ()
    authentication_classes = ()

    def get(self, request: Request) -> Response:
        return Response(parse_query(request, ListQuery))

    def post(self, request: Request) -> Response:
        return Response(parse_body(request, ThingRequest))


def get(query: str) -> Response:
    response = EchoView.as_view()(APIRequestFactory().get(f"/echo?{query}"))
    assert isinstance(response, Response)
    response.render()
    return response


def post(body: object) -> Response:
    response = EchoView.as_view()(
        APIRequestFactory().post("/echo", body, format="json")
    )
    assert isinstance(response, Response)
    response.render()
    return response


class ParseQueryTest(SimpleTestCase):
    def test_missing_parameters_take_their_defaults(self):
        response = get("")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data,
            {"page": 1, "page_size": 20, "mine": False, "fallback": True},
        )

    def test_valid_parameters_are_parsed(self):
        response = get("page=3&page_size=50&mine=true&fallback=false&name=x")
        self.assertEqual(
            response.data,
            {
                "page": 3,
                "page_size": 50,
                "mine": True,
                "fallback": False,
                "name": "x",
            },
        )

    def test_an_empty_value_takes_the_default(self):
        response = get("page=&page_size=&mine=&fallback=")
        self.assertEqual(
            response.data,
            {"page": 1, "page_size": 20, "mine": False, "fallback": True},
        )

    def test_out_of_range_numbers_are_clamped(self):
        response = get("page=-4&page_size=1000")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["page"], 1)
        self.assertEqual(response.data["page_size"], 100)

    def test_a_malformed_number_is_a_400_naming_the_field(self):
        response = get("page=2&page_size=x")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data,
            {
                "errors": [
                    {
                        "field": "page_size",
                        "message": "A valid integer is required.",
                        "code": "invalid",
                    }
                ]
            },
        )

    def test_flags_never_fail(self):
        for value, mine, fallback in (
            ("TRUE", True, True),
            (" true ", True, True),
            ("1", False, True),
            ("0", False, False),
            ("yes", False, True),
            ("False", False, False),
        ):
            with self.subTest(value=value):
                response = get(f"mine={value}&fallback={value}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["mine"], mine)
                self.assertEqual(response.data["fallback"], fallback)


class ParseBodyTest(SimpleTestCase):
    def test_a_valid_body_is_parsed(self):
        response = post({"count": 3, "enabled": True, "extra": "ignored"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"count": 3, "enabled": True})

    def test_a_missing_field_is_a_400_naming_it(self):
        response = post({})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data["errors"],
            [
                {
                    "field": "count",
                    "message": "This field is required.",
                    "code": "required",
                }
            ],
        )

    def test_a_body_that_is_not_an_object_is_the_usual_parse_error(self):
        response = post([1, 2])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["errors"][0]["code"], "parse_error")


class QueryFlagFieldTest(SimpleTestCase):
    def test_exactly_one_spelling_list_is_required(self):
        with self.assertRaises(ValueError):
            QueryFlagField()
        with self.assertRaises(ValueError):
            QueryFlagField(true_values={"true"}, false_values={"false"})


class TimelineQuery(serializers.Serializer[None]):
    favorite = TristateFlagField()


class TristateFlagFieldTest(SimpleTestCase):
    def parse(self, query: dict[str, str]) -> dict[str, bool]:
        serializer = TimelineQuery(data=QueryDict(urlencode(query)))
        serializer.is_valid(raise_exception=True)
        return dict(serializer.validated_data)

    def test_a_false_word_is_false_and_any_other_word_true(self):
        for value, expected in (
            ("false", False),
            (" OFF ", False),
            ("0", False),
            ("no", False),
            ("true", True),
            ("1", True),
            ("anything", True),
        ):
            with self.subTest(value=value):
                self.assertEqual(
                    {"favorite": expected}, self.parse({"favorite": value})
                )

    def test_an_absent_or_blank_flag_is_left_out(self):
        for query in ({}, {"favorite": ""}, {"favorite": "  "}):
            with self.subTest(query=query):
                self.assertEqual({}, self.parse(query))
