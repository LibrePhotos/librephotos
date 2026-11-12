"""A photo's non-destructive edit: its recipe, its history and its rendition.

The original file is never written. ``api.editing`` renders the recipe and
keeps the rendition files; this row only says what they are. The JSON shapes
are those of ``apps/docs/docs/development/photo-editing.md``.
"""

from django.db import models


def default_recipe_json() -> dict[str, int]:
    """The default recipe: changes nothing."""
    return {"version": 1}


class PhotoEdit(models.Model):
    """The edit of one photo, owner only; no row means never edited."""

    class Rendition(models.TextChoices):
        # No edit to show: the recipe changes nothing.
        NONE = "none"
        # The thumbnails show the request-time render; the full size is queued.
        PENDING = "pending"
        # The full-size rendition is on disk.
        READY = "ready"
        # The full-size render failed; the thumbnails show the request-time render.
        FAILED = "failed"

    photo = models.OneToOneField(
        "Photo", on_delete=models.CASCADE, related_name="edit", primary_key=True
    )
    # The sparse recipe (``api.editing.recipe.recipe_to_json``).
    settings = models.JSONField(default=default_recipe_json)
    # Steps ``{action, control, value, at, settings}``, oldest first, at most 200.
    history = models.JSONField(default=list)
    # The step whose recipe ``settings`` is; -1 is the default recipe.
    history_cursor = models.IntegerField(default=-1)
    # Up by one on every save; a background render of an older one is dropped.
    version = models.PositiveIntegerField(default=0)
    rendition = models.CharField(
        max_length=8, choices=Rendition.choices, default=Rendition.NONE
    )
    # The edited picture at full size; null while the recipe changes nothing.
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    # The upright source the recipe was rendered on, full size: the frame face
    # boxes are moved through when the geometry changes.
    source_width = models.PositiveIntegerField(null=True, blank=True)
    source_height = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "api_photo_edit"

    def __str__(self) -> str:
        return f"Edit {self.version} of photo {self.photo_id}"

    @property
    def shown(self) -> bool:
        """Whether the thumbnails show this edit rather than the original."""
        return self.rendition != self.Rendition.NONE
