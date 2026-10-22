from __future__ import annotations

from django.db import models

from api.models.scopes import OwnedQuerySet
from api.models.user import User


class UploadFollowupStateQuerySet(OwnedQuerySet["UploadFollowupState"]):
    owner_lookup = "user"


class UploadFollowupState(models.Model):
    """Where a user's upload follow-ups stand (#2735, #2191 Phase 2).

    The library-level work that uploads need (search embeddings and the
    similarity index, face encodings) runs as one debounced task per user,
    ``api.jobs.upload_followups.run_upload_followups``. This row coordinates
    it:

    - ``lease_holder`` / ``lease_expires_at``: the run that is working now.
      Taken and renewed by conditional updates on the holder's token, so two
      workers never both hold it and a holder that let it expire cannot renew.
    - ``dirty``: a request arrived while a run held the lease; the run loops
      once more instead of releasing.
    - ``photos_added``: photos were added since the last run took the flag; it
      decides whether the similarity index needs a rebuild.
    - ``face_watermark``, ``last_clustered_at``, ``last_face_label_at``: for
      the face clustering step of #2738 (the highest ``Face.pk`` at the last
      clustering, when it ran, when the user last labelled a face).
    """

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="upload_followup_state",
    )
    lease_holder = models.CharField(max_length=32, blank=True, default="")
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    dirty = models.BooleanField(default=False)
    photos_added = models.BooleanField(default=False)
    face_watermark = models.PositiveIntegerField(default=0)
    last_clustered_at = models.DateTimeField(null=True, blank=True)
    last_face_label_at = models.DateTimeField(null=True, blank=True)

    objects = UploadFollowupStateQuerySet.as_manager()

    class Meta:
        verbose_name = "Upload Follow-up State"
        verbose_name_plural = "Upload Follow-up States"

    def __str__(self) -> str:
        return f"Upload follow-ups of user {self.user_id}"
