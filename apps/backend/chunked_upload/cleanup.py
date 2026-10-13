"""Remove chunked uploads that were never finished in time.

A cancelled or abandoned web upload leaves its staged ``.part`` file and its
row behind. ``start_job_cleanup_service`` schedules
``delete_expired_uploads`` daily by dotted path; the ``delete_expired_uploads``
management command runs the same function by hand.
"""

from collections.abc import Callable

from django.utils import timezone

from chunked_upload.constants import COMPLETE, UPLOADING
from chunked_upload.models import ChunkedUpload
from chunked_upload.settings import EXPIRATION_DELTA


def delete_expired_uploads(
    confirm: Callable[[ChunkedUpload], bool] | None = None,
) -> dict[int, int]:
    """Delete uploads created more than ``EXPIRATION_DELTA`` ago, with their files.

    ``confirm`` is asked about each upload first; ``None`` deletes them all.
    Returns how many were deleted per status (``UPLOADING``, ``COMPLETE``).
    """
    count = {UPLOADING: 0, COMPLETE: 0}
    expired = ChunkedUpload.objects.filter(
        created_on__lt=timezone.now() - EXPIRATION_DELTA
    )
    for chunked_upload in expired:
        if confirm is not None and not confirm(chunked_upload):
            continue
        count[chunked_upload.status] += 1
        # One by one, so ChunkedUpload.delete removes each staged file too.
        chunked_upload.delete()
    return count
