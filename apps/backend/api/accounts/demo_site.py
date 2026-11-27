from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.utils.module_loading import import_string
from rest_framework.exceptions import PermissionDenied
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

SIGN_IN_PATHS = frozenset(
    {
        "/api/auth/token/obtain/",
        "/api/auth/token/refresh/",
        "/api/auth/token/blacklist/",
    }
)

READ_ONLY_CODE = "demo_site_read_only"


def allows_on_demo_site(method: str, path: str) -> bool:
    if method.upper() in READ_METHODS:
        return True
    normalized = path if path.endswith("/") else f"{path}/"
    return normalized in SIGN_IN_PATHS


def read_only_response() -> HttpResponse:
    error = PermissionDenied(
        "This is a view-only demo: nothing can be changed here.",
        code=READ_ONLY_CODE,
    )
    handler = import_string(str(settings.REST_FRAMEWORK["EXCEPTION_HANDLER"]))
    response = handler(error, {})
    if not isinstance(response, Response):
        raise error
    return HttpResponse(
        JSONRenderer().render(response.data),
        status=response.status_code,
        content_type="application/json",
    )


class DemoSiteReadOnlyMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if settings.DEMO_SITE and not allows_on_demo_site(
            request.method or "", request.path_info
        ):
            return read_only_response()
        return self.get_response(request)
