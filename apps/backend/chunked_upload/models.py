import hashlib
import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import models
from django.utils import timezone

from .constants import CHUNKED_UPLOAD_CHOICES, COMPLETE, UPLOADING
from .settings import (
    DEFAULT_MODEL_USER_FIELD_BLANK,
    DEFAULT_MODEL_USER_FIELD_NULL,
    EXPIRATION_DELTA,
    STORAGE,
    UPLOAD_TO,
)


def generate_upload_id() -> str:
    return uuid.uuid4().hex


class AbstractChunkedUpload(models.Model):
    """
    Base chunked upload model. This model is abstract (doesn't create a table
    in the database).
    Inherit from this model to implement your own.

    An upload is UPLOADING while it takes chunks, COMPLETE while its
    completion runs, and deleted once that is done (or it expired). Each move
    is a conditional update of the row (``claim_chunk``, ``give_back_chunk``,
    ``claim_completion``, ``reopen``, ``delete_if_idle``), so two requests
    that read the row at once cannot both make it. ``updated_on`` is the last
    chunk or completion, which expiry counts from.
    """

    upload_id = models.CharField(
        max_length=32, unique=True, editable=False, default=generate_upload_id
    )
    file = models.FileField(max_length=255, upload_to=UPLOAD_TO, storage=STORAGE)
    filename = models.CharField(max_length=255)
    offset = models.BigIntegerField(default=0)
    created_on = models.DateTimeField(auto_now_add=True)
    updated_on = models.DateTimeField(default=timezone.now)
    status = models.PositiveSmallIntegerField(
        choices=CHUNKED_UPLOAD_CHOICES, default=UPLOADING
    )
    completed_on = models.DateTimeField(null=True, blank=True)

    # md5 cache, not a database field. None until md5 is first computed, and
    # reset whenever a chunk is written.
    _md5: str | None = None

    @property
    def expires_on(self) -> datetime:
        return self.updated_on + EXPIRATION_DELTA

    @property
    def expired(self) -> bool:
        return self.expires_on <= timezone.now()

    @property
    def md5(self) -> str:
        if self._md5 is None:
            md5 = hashlib.md5()
            for chunk in self.file.chunks():
                md5.update(chunk)
            self._md5 = md5.hexdigest()
        return self._md5

    # delete_file is keyword-only: Model.delete takes (using, keep_parents) as
    # positionals, so a positional delete_file would be passed on as `using`.
    # The Model.delete result is returned, as the override of it must.
    def delete(
        self, *args: Any, delete_file: bool = True, **kwargs: Any
    ) -> tuple[int, dict[str, int]]:
        if self.file:
            storage, path = self.file.storage, self.file.path
        result = super().delete(*args, **kwargs)
        if self.file and delete_file:
            storage.delete(path)
        return result

    def __str__(self) -> str:
        return f"<{self.filename} - upload_id: {self.upload_id} - bytes: {self.offset} - status: {self.status}>"

    def write_chunk(self, chunk: UploadedFile, start: int) -> None:
        """Write ``chunk`` at byte ``start`` of the staged file.

        At its place rather than appended, so a chunk written again after a
        failed write covers the same bytes.
        """
        self.file.close()
        with open(self.file.path, mode="r+b") as file_obj:
            file_obj.seek(start)
            # The chunk is in memory already.
            file_obj.write(chunk.read())
        self._md5 = None

    def _move(self, when: Mapping[str, object], **changes: object) -> bool:
        """Apply ``changes`` if the row still matches ``when``; whether it did."""
        rows = type(self)._default_manager.filter(pk=self.pk, **when)
        if not rows.update(**changes):
            return False
        for name, value in changes.items():
            setattr(self, name, value)
        return True

    def claim_chunk(self, start: int, end: int) -> bool:
        """Take bytes ``start`` to ``end`` for one request to write."""
        when = {"status": UPLOADING, "offset": start}
        return self._move(when, offset=end, updated_on=timezone.now())

    def give_back_chunk(self, start: int, end: int) -> None:
        """Undo ``claim_chunk`` after its bytes could not be written."""
        self._move({"status": UPLOADING, "offset": end}, offset=start)

    def claim_completion(self) -> bool:
        """UPLOADING to COMPLETE, for the one completion that imports it."""
        now = timezone.now()
        return self._move(
            {"status": UPLOADING}, status=COMPLETE, completed_on=now, updated_on=now
        )

    def reopen(self) -> None:
        """COMPLETE back to UPLOADING: the completion failed, a retry may run it."""
        self._move({"status": COMPLETE}, status=UPLOADING, completed_on=None)

    def delete_if_idle(self, cutoff: datetime) -> bool:
        """Delete the upload and its file unless it was active since ``cutoff``."""
        rows = type(self)._default_manager.filter(pk=self.pk, updated_on__lt=cutoff)
        if not rows.delete()[0]:
            return False
        if self.file.name:
            self.file.storage.delete(self.file.name)
        return True

    def get_uploaded_file(self) -> UploadedFile:
        self.file.close()
        self.file.open(mode="rb")  # mode = read+binary
        return UploadedFile(file=self.file, name=self.filename, size=self.offset)

    class Meta:
        abstract = True


class ChunkedUpload(AbstractChunkedUpload):
    """
    Default chunked upload model.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="chunked_uploads",
        null=DEFAULT_MODEL_USER_FIELD_NULL,
        blank=DEFAULT_MODEL_USER_FIELD_BLANK,
    )
