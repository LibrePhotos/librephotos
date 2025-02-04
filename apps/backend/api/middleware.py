class FingerPrintMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        # One-time configuration and initializatio

    def __call__(self, request):
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
        request.fingerprint = fingerprint
        # print(fingerprint)
        return response
