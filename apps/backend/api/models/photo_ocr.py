from django.db import models


class PhotoOcr(models.Model):
    """Stored OCR result for a photo.

    Holds the plaintext extracted by the OCR sidecar plus the per-block
    geometry/confidence payload. One row per photo (OneToOne, PK on the photo)
    mirroring :class:`api.models.photo_search.PhotoSearch`.
    """

    # Cap stored text so a pathological document scan cannot bloat a single row.
    MAX_TEXT_LENGTH = 20000
    # Cap the number of blocks retained. The full geometry is only needed for
    # highlighting; a sane bound keeps the JSON payload small.
    MAX_BLOCKS = 500

    photo = models.OneToOneField(
        "Photo",
        on_delete=models.CASCADE,
        related_name="ocr",
        primary_key=True,
    )
    # No db_index: a btree index on a TextField breaks in Postgres once an entry
    # exceeds ~2704 bytes. Full-text search over OCR text comes later via FTS.
    text = models.TextField(blank=True, null=True)
    blocks = models.JSONField(default=list, blank=True)
    engine = models.CharField(max_length=64, blank=True, default="")
    mean_confidence = models.FloatField(null=True, blank=True)
    text_area_fraction = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "api_photo_ocr"

    def __str__(self):
        return f"OCR data for {self.photo.image_hash}"

    def apply_caps(self):
        """Truncate ``text`` and ``blocks`` to their storage bounds in place."""
        if self.text and len(self.text) > self.MAX_TEXT_LENGTH:
            self.text = self.text[: self.MAX_TEXT_LENGTH]
        if isinstance(self.blocks, list) and len(self.blocks) > self.MAX_BLOCKS:
            self.blocks = self.blocks[: self.MAX_BLOCKS]

    def save(self, *args, **kwargs):
        self.apply_caps()
        super().save(*args, **kwargs)
