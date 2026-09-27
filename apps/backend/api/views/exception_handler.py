"""The DRF exception handler named by ``REST_FRAMEWORK["EXCEPTION_HANDLER"]``."""

from django.conf import settings
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    # Call REST framework's default exception handler first,
    # to get the standard error response.
    response = exception_handler(exc, context)

    # Update the structure of the response data and enrich auth errors.
    if response is not None:
        customized_response = {"errors": []}

        if isinstance(response.data, dict):
            for key, value in response.data.items():
                # DRF gives per-field errors as a list of ErrorDetail. str() on
                # the list yields its repr, which used to leak into the response
                # as "[ErrorDetail(string='...', code='unique')]".
                if isinstance(value, (list, tuple)):
                    message = " ".join(str(item) for item in value)
                else:
                    message = str(value)
                error = {"field": key, "message": message}
                customized_response["errors"].append(error)
        elif isinstance(response.data, list):
            # Handle ValidationError raised with a string (creates a list)
            for item in response.data:
                error = {"field": "non_field_errors", "message": str(item)}
                customized_response["errors"].append(error)

        # Add actionable guidance for unauthenticated/forbidden responses
        if getattr(response, "status_code", None) in (401, 403) and settings.DEBUG:
            customized_response["errors"].append(
                {
                    "field": "auth",
                    "message": (
                        "Authentication required. Obtain a JWT via POST /api/auth/token/obtain/ "
                        'with JSON {"username":"<user>", "password":"<pass>"}. '
                        "Then call APIs with header Authorization: Bearer <access_token> (or use the 'jwt' cookie set by the obtain/refresh endpoints). "
                        "See /api/help and docs at https://docs.librephotos.com/docs/user-guide/api-authentication."
                    ),
                }
            )

        response.data = customized_response

    return response
