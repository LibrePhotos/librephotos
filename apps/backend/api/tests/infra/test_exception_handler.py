"""The error envelope every raised API exception is rendered as (#2325)."""

from django.http import Http404
from django.test import SimpleTestCase
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from api.exceptions import (
    Conflict,
    EditSuperseded,
    Gone,
    InsufficientStorage,
    ServiceUnavailable,
    UpstreamError,
)
from api.views.exception_handler import custom_exception_handler


def render(exc: Exception) -> Response:
    response = custom_exception_handler(exc, {})
    assert response is not None
    return response


class ExceptionHandlerTest(SimpleTestCase):
    def test_a_field_error_names_its_field_and_code(self):
        response = render(
            ValidationError({"new_password": "Too short."}, code="weak_password")
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data,
            {
                "errors": [
                    {
                        "field": "new_password",
                        "message": "Too short.",
                        "code": "weak_password",
                    }
                ]
            },
        )

    def test_a_non_field_error_gets_drfs_default_code(self):
        response = render(ValidationError("Missing parameters"))

        self.assertEqual(
            response.data,
            {
                "errors": [
                    {
                        "field": "non_field_errors",
                        "message": "Missing parameters",
                        "code": "invalid",
                    }
                ]
            },
        )

    def test_several_messages_for_one_field_are_one_entry(self):
        response = render(ValidationError({"name": ["Too short.", "Taken."]}))

        self.assertEqual(
            response.data["errors"],
            [{"field": "name", "message": "Too short. Taken.", "code": "invalid"}],
        )

    def test_a_detail_error_carries_the_exception_code(self):
        self.assertEqual(
            render(NotFound("photo not found")).data["errors"],
            [{"field": "detail", "message": "photo not found", "code": "not_found"}],
        )
        self.assertEqual(render(Http404()).data["errors"][0]["code"], "not_found")

    def test_custom_exceptions_have_their_status_and_code(self):
        for exc, status_code, code in (
            (Conflict(), 409, "conflict"),
            (EditSuperseded(), 409, "edit_superseded"),
            (Gone(code="cursor_expired"), 410, "cursor_expired"),
            (
                UpstreamError("SMTP said no", code="email_send_failed"),
                502,
                "email_send_failed",
            ),
            (ServiceUnavailable(), 503, "service_unavailable"),
            (InsufficientStorage(), 507, "insufficient_storage"),
        ):
            with self.subTest(type(exc).__name__):
                response = render(exc)
                self.assertEqual(response.status_code, status_code)
                [entry] = response.data["errors"]
                self.assertEqual(entry["field"], "detail")
                self.assertEqual(entry["code"], code)

    def test_upstream_error_keeps_the_upstream_message(self):
        [entry] = render(
            UpstreamError("535 Authentication failed", code="email_send_failed")
        ).data["errors"]

        self.assertEqual(entry["message"], "535 Authentication failed")

    def test_service_unavailable_can_ask_for_a_retry(self):
        response = render(
            ServiceUnavailable("downloading", code="model_downloading", retry_after=60)
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "60")
        self.assertEqual(response.data["errors"][0]["code"], "model_downloading")

    def test_without_retry_after_there_is_no_header(self):
        self.assertFalse(render(ServiceUnavailable()).has_header("Retry-After"))

    def test_an_exception_drf_does_not_know_is_left_to_django(self):
        self.assertIsNone(custom_exception_handler(RuntimeError("boom"), {}))
