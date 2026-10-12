"""What the daily cleanup schedule purges: removed photos and old sync tombstones.

Both run as django-q schedules created by ``start_cleaning_service``, which
stores them by dotted path (``api.photos.retention.<name>``); migration 0157
moved the existing rows here from ``api.services``.
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from api.models import DeletionLog, Photo


def cleanup_deleted_photos() -> None:
    """Delete the photos removed more than 30 days ago."""
    deleted_photos = Photo.objects.filter(
        Q(removed=True) & Q(last_modified__lte=timezone.now() - timedelta(days=30))
    )
    for photo in deleted_photos:
        photo.delete()


def prune_deletion_log() -> int:
    """Drop tombstones past the mobile-v2 sync horizon (doc 04 §2).

    A client whose cursor predates the oldest surviving tombstone can no longer
    trust the delta feed to tell it what was deleted, so it must reseed; the
    sync endpoints answer such a cursor with ``410 cursor_expired``. Keeping
    tombstones beyond that horizon only grows the table.
    """
    horizon = timezone.now() - timedelta(days=DeletionLog.PRUNE_HORIZON_DAYS)
    deleted, _ = DeletionLog.objects.filter(deleted_at__lt=horizon).delete()
    return deleted
