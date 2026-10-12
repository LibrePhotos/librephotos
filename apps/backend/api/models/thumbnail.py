from __future__ import annotations

import os

from django.conf import settings
from django.db import models

from api.models.photo import Photo

# Static thumbnails are webp; the animated ones videos get instead are mp4.
STATIC_THUMBNAIL_DIRS = (
    "thumbnails_big",
    "square_thumbnails",
    "square_thumbnails_small",
)
ANIMATED_THUMBNAIL_DIRS = ("square_thumbnails", "square_thumbnails_small")


def thumbnail_file_paths(photo_hash: str) -> list[str]:
    """Every path a thumbnail named after ``photo_hash`` can have."""
    named = [(d, ".webp") for d in STATIC_THUMBNAIL_DIRS]
    named += [(d, ".mp4") for d in ANIMATED_THUMBNAIL_DIRS]
    return [
        os.path.join(settings.MEDIA_ROOT, output_dir, photo_hash + extension)
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

    def main_file_path(self) -> str:
        """Path of the photo's main file, which every thumbnail is made from."""
        main_file = self.photo.main_file
        assert main_file is not None, "thumbnails are only made for a photo's main file"
        return main_file.path
