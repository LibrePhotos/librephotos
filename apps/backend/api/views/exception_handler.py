"""The DRF exception handler named by ``REST_FRAMEWORK["EXCEPTION_HANDLER"]``.

It is the only place that writes an API error body. Every raised DRF exception
answers ``{"errors": [{"field": ..., "message": ..., "code": ...}]}``: ``field``
names the request field at fault (``non_field_errors`` or ``detail`` when there
is none), ``message`` is for people, ``code`` is what clients branch on.
"""

from typing import Any

from django.conf import settings
from rest_framework.exceptions import ErrorDetail
from rest_framework.response import Response
from rest_framework.views import exception_handler

# The code of an entry whose value carries none, such as a plain string.
FALLBACK_CODE = "error"


def _first_code(value: object) -> str | None:
    """The code of the first ``ErrorDetail`` in ``value``, depth first."""
    if isinstance(value, ErrorDetail):
        return value.code
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, (list, tuple)):
        for item in value:
            code = _first_code(item)
            if code is not None:
                return code
    return None


def _entry(field: str, value: object) -> dict[str, str]:
    # DRF gives per-field errors as a list of ErrorDetail. str() on the list
    # yields its repr, which used to leak into the response as
    # "[ErrorDetail(string='...', code='unique')]".
    if isinstance(value, (list, tuple)):
        message = " ".join(str(item) for item in value)
    else:
        message = str(value)
    return {
        "field": field,
        "message": message,
        "code": _first_code(value) or FALLBACK_CODE,
    }


def custom_exception_handler(
    exc: Exception, context: dict[str, Any]
) -> Response | None:
    # Call REST framework's default exception handler first,
    # to get the standard error response.
    response = exception_handler(exc, context)

    # Update the structure of the response data and enrich auth errors.
    if response is not None:
        errors: list[dict[str, str]] = []

        if isinstance(response.data, dict):
            for key, value in response.data.items():
                errors.append(_entry(key, value))
        elif isinstance(response.data, list):
            # Handle ValidationError raised with a string (creates a list)
            for item in response.data:
                errors.append(_entry("non_field_errors", item))

        # Add actionable guidance for unauthenticated/forbidden responses
        if getattr(response, "status_code", None) in (401, 403) and settings.DEBUG:
            errors.append(
                {
                    "field": "auth",
                    "message": (
                        "Authentication required. Obtain a JWT via POST /api/auth/token/obtain/ "
                        'with JSON {"username":"<user>", "password":"<pass>"}. '
                        "Then call APIs with header Authorization: Bearer <access_token> (or use the 'jwt' cookie set by the obtain/refresh endpoints). "
                        "See /api/help and docs at https://docs.librephotos.com/docs/user-guide/api-authentication."
                    ),
                    "code": "authentication_help",
                }
            )

        response.data = {"errors": errors}

    return response
