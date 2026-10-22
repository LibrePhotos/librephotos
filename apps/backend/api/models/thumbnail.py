from __future__ import annotations

import os

from django.conf import settings
from django.db import models

from api.models.photo import Photo

# Static thumbnails are webp. A video's squares are mp4 clips instead, or webp
# stills when the animated previews are switched off (#649); a video can have
# either on disk, depending on the switch when it was last scanned.
STATIC_THUMBNAIL_DIRS = (
    "thumbnails_big",
    "square_thumbnails",
    "square_thumbnails_small",
)
ANIMATED_THUMBNAIL_DIRS = ("square_thumbnails", "square_thumbnails_small")


def is_safe_file_stem(name: str) -> bool:
    """Whether ``name`` can name a file in a directory and nothing else.

    No separator (either kind, on every platform), no ``.`` or ``..``, no NUL:
    a photo's hash goes into paths that are written and deleted.
    """
    return (
        bool(name)
        and name not in (".", "..")
        and not any(char in name for char in ("/", "\\", "\0"))
    )


def thumbnail_path(output_dir: str, photo_hash: str, extension: str) -> str:
    """The file ``output_dir/<photo_hash><extension>`` under MEDIA_ROOT.

    Raises ValueError for a hash that is not a bare file name, so a bad row can
    never point a write or a delete outside the thumbnail directory.
    """
    if not is_safe_file_stem(photo_hash):
        raise ValueError(f"not a photo hash: {photo_hash!r}")
    return os.path.join(settings.MEDIA_ROOT, output_dir, photo_hash + extension)


def thumbnail_file_paths(photo_hash: str) -> list[str]:
    """Every path a thumbnail named after ``photo_hash`` can have.

    Both formats of the squares: deleting a photo removes whichever exists.
    """
    named = [(d, ".webp") for d in STATIC_THUMBNAIL_DIRS]
    named += [(d, ".mp4") for d in ANIMATED_THUMBNAIL_DIRS]
    return [
        thumbnail_path(output_dir, photo_hash, extension)
        for output_dir, extension in named
    ]


class Thumbnail(models.Model):
    photo = models.OneToOneField(
        Photo, on_delete=models.CASCADE, related_name="thumbnail", primary_key=True
    )
    thumbnail_big = models.ImageField(upload_to="thumbnails_big")
    square_thumbnail = models.ImageField(upload_to="square_thumbnails")
    square_thumbnail_small = models.ImageField(upload_to="square_thumbnails_small")
    aspect_ratio = models.FloatField(blank=True, null=True)
    dominant_color = models.TextField(blank=True, null=True)
    # A video's WebP stills sit beside its squares (``<image_hash>.webp`` in
    # both square directories): the grid shows them until the pointer rests
    # on the tile and the clip plays (#2026). With the animated previews off
    # (#649) they are the squares themselves.
    video_poster = models.BooleanField(default=False)

    class Meta:
        indexes = [
            # "Has a thumbnail" (aspect_ratio set) is part of every visible
            # photo filter; joined from the photo side as an index-only scan.
            models.Index(
                fields=["photo"],
                condition=models.Q(aspect_ratio__isnull=False),
                name="thumbnail_ready_idx",
            ),
        ]

    @property
    def has_animated_squares(self) -> bool:
        """Whether the squares are mp4 clips rather than WebP stills (#649)."""
        name = self.square_thumbnail.name
        return bool(name and name.endswith(".mp4"))

    def main_file_path(self) -> str:
        """Path of the photo's main file, which every thumbnail is made from."""
        main_file = self.photo.main_file
        assert main_file is not None, "thumbnails are only made for a photo's main file"
        return main_file.path
