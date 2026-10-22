"""The library-level work after uploads: one debounced, leased run per user (#2735).

An upload gets its thumbnails, tags, place and faces per photo, in its own
chain (``api.views.upload``). What a scan's follow-ups do for the whole
library never ran for uploads: the similarity index was not rebuilt, photos
got no search embedding when tagging was off, and faces from XMP regions got
no encoding. This module runs those steps, once per burst of uploads.

- ``request_upload_followups(user)``: something added photos for ``user``. It
  marks ``photos_added`` and, unless a run holds the lease (which then loops
  once more, ``dirty``), schedules ``run_upload_followups(user.id)`` at most
  ``DEBOUNCE`` ahead. 50 uploads in a row give one run.
- ``run_upload_followups(user_id)``: takes the user's lease, runs
  ``FOLLOWUP_STEPS`` in order (renewing the lease after each step and inside
  the long ones), and releases it; a request that came in meanwhile makes it
  go round once more.
- ``schedule_upload_followups(user, at)``: (re-)arm the run for ``at`` or
  sooner, for a step that has to wait (#2738's clustering quiet period).
- ``backfill_upload_followups()``: once per instance, at startup, a staggered
  request for every user with photos, for the uploads made before this ran.

Seam for the rest of #2191: an upload import job (#2737) calls
``request_upload_followups`` when it finishes, instead of the upload chain's
last task; a new step (#2738's clustering, #2736's OCR) is a function taking a
``FollowupRun``, appended to ``FOLLOWUP_STEPS``. Each step decides itself
whether it has work and must be safe to repeat.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from constance import config as site_config
from django.db.models import Q
from django.utils import timezone

from api.directory_watcher.processing_jobs import generate_face_embeddings
from api.jobs.queue import schedule_once_by
from api.models import Photo, UploadFollowupState, User
from api.models.upload_followup_state import UploadFollowupStateQuerySet
from api.runtime.features import feature_enabled
from api.search.embedding_jobs import (
    batch_calculate_clip_embedding,
    photos_missing_clip_embeddings,
)
from api.search.similarity import build_image_similarity_index

logger = logging.getLogger(__name__)

# How long after a request the run starts at the latest: uploads within this
# window share one run.
DEBOUNCE = timedelta(minutes=2)
# A lease not renewed for this long is free again: its holder died. Renewed
# after every step and every batch of a step, so it measures liveness, not
# how long a run takes.
LEASE = timedelta(minutes=15)
# The backfill spreads its requests this far apart, one user after another.
BACKFILL_SPACING = timedelta(minutes=1)

RUN_FUNC = "api.jobs.upload_followups.run_upload_followups"


def _states(user: User) -> UploadFollowupStateQuerySet:
    """The user's state row, created on first use."""
    UploadFollowupState.objects.get_or_create(user=user)
    return UploadFollowupState.objects.owned_by(user)


def schedule_upload_followups(user: User, at: datetime) -> None:
    """Make the user's follow-up run start at ``at`` or sooner."""
    schedule_once_by(f"upload-followups-{user.id}", RUN_FUNC, user.id, at=at)


def request_upload_followups(user: User, delay: timedelta = DEBOUNCE) -> None:
    """Photos were added for ``user``: run the follow-ups within ``delay``."""
    states = _states(user)
    states.update(photos_added=True)
    if states.filter(lease_expires_at__gt=timezone.now()).update(dirty=True):
        # The run holding the lease loops once more when it is done.
        return
    schedule_upload_followups(user, timezone.now() + delay)


class FollowupLease:
    """The user's lease, held under a token by one run at a time."""

    def __init__(self, user: User, token: str) -> None:
        self.user = user
        self.token = token

    @classmethod
    def acquire(cls, user: User) -> FollowupLease | None:
        """Take the lease when it is free or expired; ``None`` while it is held."""
        now = timezone.now()
        token = uuid.uuid4().hex
        taken = (
            _states(user)
            .filter(Q(lease_expires_at__isnull=True) | Q(lease_expires_at__lte=now))
            .update(lease_holder=token, lease_expires_at=now + LEASE, dirty=False)
        )
        return cls(user, token) if taken else None

    def _held(self) -> UploadFollowupStateQuerySet:
        return UploadFollowupState.objects.owned_by(self.user).filter(
            lease_holder=self.token, lease_expires_at__gt=timezone.now()
        )

    def renew(self) -> bool:
        """Extend the lease; ``False`` once it expired or someone else took it."""
        return bool(self._held().update(lease_expires_at=timezone.now() + LEASE))

    def release(self) -> bool:
        """Give the lease up unless a request came in; whether the run is done.

        ``False`` means ``dirty`` was set while the run worked: the flag is
        cleared and the run goes round once more, still holding the lease.
        """
        if (
            self._held()
            .filter(dirty=False)
            .update(lease_holder="", lease_expires_at=None)
        ):
            return True
        if self._held().update(dirty=False, lease_expires_at=timezone.now() + LEASE):
            return False
        # Lost on the way: a request may have marked it dirty and left the
        # run to us. A scheduled run that finds the lease held does nothing.
        schedule_upload_followups(self.user, timezone.now())
        return True


@dataclass
class FollowupRun:
    """What the steps of one pass share."""

    user: User
    # Whether photos were added since the last pass took the flag.
    photos_added: bool
    # Renews the lease; for the steps' own loops.
    heartbeat: Callable[[], object]
    # Whether a step rebuilt the similarity index already.
    index_rebuilt: bool = False
    # The steps that raised, by name.
    failed: list[str] = field(default_factory=list)


def _photos_to_embed(user: User) -> bool:
    """Whether a photo with a big thumbnail lacks its search embedding."""
    return (
        photos_missing_clip_embeddings(user)
        .filter(thumbnail__thumbnail_big__isnull=False)
        .exclude(thumbnail__thumbnail_big="")
        .exists()
    )


def embed_missing_photos(run: FollowupRun) -> None:
    """Embed the photos without a search embedding; that rebuilds the index."""
    if not _photos_to_embed(run.user):
        return
    run.index_rebuilt = True
    batch_calculate_clip_embedding(run.user, heartbeat=run.heartbeat)


def rebuild_similarity_index(run: FollowupRun) -> None:
    """Take new photos into the index when no step rebuilt it.

    With tagging on, the per-photo tagger stores the embeddings, so nothing
    is left to embed, but the index still lacks the new photos.
    """
    if run.index_rebuilt or not run.photos_added:
        return
    run.index_rebuilt = True
    build_image_similarity_index(run.user)


def encode_faces(run: FollowupRun) -> None:
    """Encode the faces that have none, such as those read from XMP regions."""
    if not feature_enabled("FACE_DETECTION"):
        return
    generate_face_embeddings(run.user, heartbeat=run.heartbeat)


FollowupStep = Callable[[FollowupRun], None]

# In order: the index first, so uploads are searchable as soon as possible.
FOLLOWUP_STEPS: tuple[FollowupStep, ...] = (
    embed_missing_photos,
    rebuild_similarity_index,
    encode_faces,
)


def _take_photos_added(user: User) -> bool:
    """Clear ``photos_added`` before any work; whether it was set.

    Photos added during the pass set it again, and the request that does so
    also marks the lease dirty, so the next pass sees them.
    """
    return bool(
        UploadFollowupState.objects.owned_by(user)
        .filter(photos_added=True)
        .update(photos_added=False)
    )


def _run_pass(lease: FollowupLease) -> bool:
    """One pass over the steps; ``False`` when the lease was lost in between."""
    user = lease.user
    run = FollowupRun(
        user=user, photos_added=_take_photos_added(user), heartbeat=lease.renew
    )
    for step in FOLLOWUP_STEPS:
        try:
            step(run)
        except Exception:
            # One step failing (a sidecar down) must not cost the others.
            name = getattr(step, "__name__", repr(step))
            logger.exception("upload follow-ups of user %s: %s failed", user.id, name)
            run.failed.append(name)
        if not lease.renew():
            logger.warning("upload follow-ups of user %s lost their lease", user.id)
            return False
    return True


def run_upload_followups(user_id: int) -> None:
    """The scheduled task: the user's follow-ups, for as long as requests come in."""
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return
    lease = FollowupLease.acquire(user)
    if lease is None:
        logger.info("upload follow-ups of user %s are running already", user_id)
        return
    while True:
        if not _run_pass(lease):
            # Whoever holds it now, or the run scheduled when it was taken
            # from us, does the rest.
            schedule_upload_followups(user, timezone.now() + DEBOUNCE)
            return
        if lease.release():
            return


def backfill_upload_followups() -> int:
    """Request the follow-ups once for every user with photos; at startup.

    For the uploads made before the follow-ups existed. Runs once per
    instance (``UPLOAD_FOLLOWUPS_BACKFILL_DONE``), spreading the runs
    ``BACKFILL_SPACING`` apart. Returns how many users it requested them for.
    """
    if site_config.UPLOAD_FOLLOWUPS_BACKFILL_DONE:
        return 0
    owner_ids = Photo.objects.values_list("owner_id", flat=True).distinct()
    users = User.objects.filter(pk__in=owner_ids).order_by("pk")
    count = 0
    for count, user in enumerate(users, start=1):
        request_upload_followups(user, delay=DEBOUNCE + BACKFILL_SPACING * count)
    site_config.UPLOAD_FOLLOWUPS_BACKFILL_DONE = True
    return count
