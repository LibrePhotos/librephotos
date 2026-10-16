"""The API exceptions DRF has no class for.

A view signals an error by raising: DRF's own ``ValidationError`` (400),
``ParseError`` (400), ``NotAuthenticated`` (401), ``PermissionDenied`` (403)
or ``NotFound`` (404), or one of the classes here. The exception handler
(``api/views/exception_handler.py``) is the only place that writes an error
body, ``{"errors": [{"field", "message", "code"}]}``. Pass ``code=`` when a
client branches on the error; clients never compare message text. An exception
that sets ``entry_fields`` (a dict of strings) adds those fields to its entry,
such as ``JobAlreadyRunning``'s ``job_id``.
"""

from rest_framework import status
from rest_framework.exceptions import APIException


class Conflict(APIException):
    """409: the request clashes with the current state of the resource."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state."
    default_code = "conflict"


class Gone(APIException):
    """410: what the request points at existed once and is gone for good."""

    status_code = status.HTTP_410_GONE
    default_detail = "The resource is no longer available."
    default_code = "gone"


class UpstreamError(APIException):
    """502: a server this one depends on (SMTP, a sidecar) refused or failed."""

    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "An upstream service failed."
    default_code = "upstream_error"


class ServiceUnavailable(APIException):
    """503: the server cannot do this right now; retrying later may work."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The service is temporarily unavailable."
    default_code = "service_unavailable"

    def __init__(
        self,
        detail: str | None = None,
        code: str | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(detail, code)
        # DRF's exception_handler turns ``wait`` into a Retry-After header.
        self.wait = retry_after


class InsufficientStorage(APIException):
    """507: the server has no room to store the result."""

    status_code = status.HTTP_507_INSUFFICIENT_STORAGE
    default_detail = "Not enough free space on the server."
    default_code = "insufficient_storage"


class EditSuperseded(Conflict):
    """The edit to revert is no longer the latest change of its field."""

    default_detail = (
        "This field was changed again after this edit; reverting it would "
        "discard the later change. Retry with ?force=1 to revert anyway."
    )
    default_code = "edit_superseded"


class JobAlreadyRunning(Conflict):
    """A job of this type is already queued or running for this user.

    Its entry carries the running job's ``job_id``, so a client can follow
    that job instead of reporting an error (``api.jobs.queue.enqueue_job``).
    """

    default_detail = "This job is already running."
    default_code = "job_already_running"

    def __init__(self, job_id: str, job_name: str) -> None:
        super().__init__(f"{job_name} is already running.")
        self.job_id = job_id
        self.entry_fields = {"job_id": job_id}


class NameConflict(Conflict):
    """Names of the photos to move are taken in the target folder (#352).

    Its entry carries the ``count`` of such photos; the move preview lists them.
    """

    default_detail = "Names are taken in the target folder."
    default_code = "name_conflict"

    def __init__(self, message: str, count: int) -> None:
        super().__init__(message)
        self.entry_fields = {"count": str(count)}
