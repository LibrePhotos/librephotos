from collections.abc import Callable

from django.http import HttpRequest, HttpResponseBase


class FingerPrintMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response
        # One-time configuration and initializatio

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        response = self.get_response(request)
        import hashlib

        fingerprint_raw = "".join(
            (
                request.META.get("HTTP_USER_AGENT", ""),
                request.META.get("HTTP_ACCEPT_ENCODING", ""),
            )
        )
        # print(fingerprint_raw)
        fingerprint = hashlib.md5(fingerprint_raw.encode("utf-8")).hexdigest()
        # Set dynamically: HttpRequest has no declared `fingerprint` attribute.
        setattr(request, "fingerprint", fingerprint)
        # print(fingerprint)
        return response
