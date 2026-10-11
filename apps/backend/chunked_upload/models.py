import hashlib
import uuid
from datetime import datetime
from typing import Any

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import models
from django.utils import timezone

from .constants import CHUNKED_UPLOAD_CHOICES, UPLOADING
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
    """

    upload_id = models.CharField(
        max_length=32, unique=True, editable=False, default=generate_upload_id
    )
    file = models.FileField(max_length=255, upload_to=UPLOAD_TO, storage=STORAGE)
    filename = models.CharField(max_length=255)
    offset = models.BigIntegerField(default=0)
    created_on = models.DateTimeField(auto_now_add=True)
    status = models.PositiveSmallIntegerField(
        choices=CHUNKED_UPLOAD_CHOICES, default=UPLOADING
    )
    completed_on = models.DateTimeField(null=True, blank=True)

    # md5 cache, not a database field. None until md5 is first computed, and
    # reset whenever a chunk is appended.
    _md5: str | None = None

    @property
    def expires_on(self) -> datetime:
        return self.created_on + EXPIRATION_DELTA

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

    def append_chunk(
        self, chunk: UploadedFile, chunk_size: int | None = None, save: bool = True
    ) -> None:
        self.file.close()
        with open(self.file.path, mode="ab") as file_obj:  # mode = append+binary
            file_obj.write(
                chunk.read()
            )  # We can use .read() safely because chunk is already in memory

        if chunk_size is not None:
            self.offset += chunk_size
        elif hasattr(chunk, "size"):
            # Uploaded chunks always carry their size.
            assert chunk.size is not None
            self.offset += chunk.size
        else:
            self.offset = self.file.size
        self._md5 = None  # Clear cached md5
        if save:
            self.save()
        self.file.close()  # Flush

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
