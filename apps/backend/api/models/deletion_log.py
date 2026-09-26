from django.db import models

from api.models.user import User


class DeletionLog(models.Model):
    """Tombstone log for hard deletes and visibility losses.

    A client mirror (mobile v2, doc 04) learns "what changed since X" from the
    ``last_modified`` columns, but a row that was hard-deleted server-side, or
    that a user can no longer see because a share was revoked, leaves no
    ``last_modified`` trace to sync. Each such event writes one row here, scoped
    to the *viewer* whose mirror must drop the entity (``owner``), so the delta
    endpoints can merge tombstones into the same response.

    ``owner`` is the user who should drop the row, not necessarily the entity's
    server-side owner: un-sharing a photo from user B writes a tombstone with
    ``owner=B`` even though the photo still exists and belongs to user A.

    Rows older than :data:`PRUNE_HORIZON_DAYS` are removed by a scheduled job;
    a client whose cursor predates the prune horizon must reseed (410).
    """

    ENTITY_PHOTO = "photo"
    ENTITY_PERSON = "person"
    ENTITY_ALBUM_USER = "album_user"
    ENTITY_ALBUM_AUTO = "album_auto"
    ENTITY_ALBUM_THING = "album_thing"
    ENTITY_ALBUM_PLACE = "album_place"
    ENTITY_TAG = "tag"

    PRUNE_HORIZON_DAYS = 90

    entity = models.CharField(max_length=32, db_index=True)
    entity_id = models.CharField(max_length=64)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    deleted_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            # Keyset filter for the delta endpoints: scope by (owner, entity)
            # then range-scan deleted_at against the client's cursor.
            models.Index(
                fields=["owner", "entity", "deleted_at"],
                name="deletionlog_scope_idx",
            ),
        ]

    def __str__(self):
        return f"{self.entity}:{self.entity_id} for user {self.owner_id}"
