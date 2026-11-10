"""Remove chunked uploads that were never finished in time.

A cancelled or abandoned web upload leaves its staged ``.part`` file and its
row behind. Expiry counts from the upload's last chunk or completion
(``updated_on``), so a long upload that keeps sending chunks is kept. ``start_job_cleanup_service`` schedules
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
    """Delete uploads idle for more than ``EXPIRATION_DELTA``, with their files.

    ``confirm`` is asked about each upload first; ``None`` deletes them all.
    An upload that took a chunk since it was read is kept. Returns how many
    were deleted per status (``UPLOADING``, ``COMPLETE``).
    """
    count = {UPLOADING: 0, COMPLETE: 0}
    cutoff = timezone.now() - EXPIRATION_DELTA
    for chunked_upload in ChunkedUpload.objects.filter(updated_on__lt=cutoff):
        if confirm is not None and not confirm(chunked_upload):
            continue
        if chunked_upload.delete_if_idle(cutoff):
            count[chunked_upload.status] += 1
    return count
