import os
from functools import partial

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.db import models, transaction
from django.dispatch import receiver
from PIL import Image

from api.models.photo import Photo
from api.thumbnails import (
    create_animated_thumbnail,
    create_thumbnail,
    create_thumbnail_for_video,
    does_static_thumbnail_exist,
    does_video_thumbnail_exist,
)
from api.util import logger


class Thumbnail(models.Model):
    photo = models.OneToOneField(
        Photo, on_delete=models.CASCADE, related_name="thumbnail", primary_key=True
    )
    thumbnail_big = models.ImageField(upload_to="thumbnails_big")
    square_thumbnail = models.ImageField(upload_to="square_thumbnails")
    square_thumbnail_small = models.ImageField(upload_to="square_thumbnails_small")
    aspect_ratio = models.FloatField(blank=True, null=True)
    dominant_color = models.TextField(blank=True, null=True)

    def _generate_thumbnail(self):
        try:
            # Use photo.image_hash for thumbnail paths for frontend compatibility
            photo_hash = self.photo.image_hash
            local_orientation = getattr(self.photo, "local_orientation", 1) or 1
            if not does_static_thumbnail_exist("thumbnails_big", photo_hash):
                if not self.photo.video:
                    create_thumbnail(
                        input_path=self.photo.main_file.path,
                        output_height=1080,
                        output_path="thumbnails_big",
                        hash=photo_hash,
                        file_type=".webp",
                        local_orientation=local_orientation,
                    )
                else:
                    create_thumbnail_for_video(
                        input_path=self.photo.main_file.path,
                        output_path="thumbnails_big",
                        hash=photo_hash,
                        file_type=".webp",
                    )

            if not self.photo.video and not does_static_thumbnail_exist(
                "square_thumbnails", photo_hash
            ):
                create_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=500,
                    output_path="square_thumbnails",
                    hash=photo_hash,
                    file_type=".webp",
                    local_orientation=local_orientation,
                )
            if self.photo.video and not does_video_thumbnail_exist(
                "square_thumbnails", photo_hash
            ):
                create_animated_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=500,
                    output_path="square_thumbnails",
                    hash=photo_hash,
                    file_type=".mp4",
                )

            if not self.photo.video and not does_static_thumbnail_exist(
                "square_thumbnails_small", photo_hash
            ):
                create_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=250,
                    output_path="square_thumbnails_small",
                    hash=photo_hash,
                    file_type=".webp",
                    local_orientation=local_orientation,
                )
            if self.photo.video and not does_video_thumbnail_exist(
                "square_thumbnails_small", photo_hash
            ):
                create_animated_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=250,
                    output_path="square_thumbnails_small",
                    hash=photo_hash,
                    file_type=".mp4",
                )
            filetype = ".webp"
            if self.photo.video:
                filetype = ".mp4"
            self.thumbnail_big.name = os.path.join(
                "thumbnails_big", photo_hash + ".webp"
            )
            self.square_thumbnail.name = os.path.join(
                "square_thumbnails", photo_hash + filetype
            )
            self.square_thumbnail_small.name = os.path.join(
                "square_thumbnails_small", photo_hash + filetype
            )
            self.save()
        except Exception as e:
            logger.exception(
                f"could not generate thumbnail for image {self.photo.main_file.path}"
            )
            raise e

    def _regenerate_thumbnails(self) -> None:
        """Delete all existing thumbnail files and regenerate them.

        Picks up ``photo.local_orientation`` automatically via
        ``_generate_thumbnail``.  Should be called after updating
        ``Photo.local_orientation``.
        """
        photo_hash = self.photo.image_hash

        # Remove static (image) thumbnails
        for output_dir in (
            "thumbnails_big",
            "square_thumbnails",
            "square_thumbnails_small",
        ):
            path = os.path.join(settings.MEDIA_ROOT, output_dir, photo_hash + ".webp")
            if os.path.exists(path):
                os.remove(path)

        # Remove video thumbnails (animated MP4 clips)
        for output_dir in ("square_thumbnails", "square_thumbnails_small"):
            path = os.path.join(settings.MEDIA_ROOT, output_dir, photo_hash + ".mp4")
            if os.path.exists(path):
                os.remove(path)

        self._generate_thumbnail()
        self._calculate_aspect_ratio()

    def _calculate_aspect_ratio(self):
        try:
            # Relies on big thumbnail for correct aspect ratio. The thumbnail is
            # a file we generated ourselves, so read its dimensions directly
            # instead of asking the exif service: a photo without an aspect
            # ratio is filtered out of every grid view, and that must not hinge
            # on a sidecar being reachable.
            if not self.thumbnail_big:
                logger.warning(
                    f"no big thumbnail for photo {self.photo_id}; skipping aspect ratio"
                )
                return
            with Image.open(self.thumbnail_big.path) as img:
                width, height = img.size
            if not height or not width:
                logger.warning(
                    f"missing dimensions for image {self.thumbnail_big.path}; "
                    "skipping aspect ratio"
                )
                return
            self.aspect_ratio = round(width / height, 2)

            self.save()
        except Exception:
            logger.exception(
                f"could not calculate aspect ratio for image {self.thumbnail_big.path}"
            )

    def _get_dominant_color(self, palette_size=16):
        # Skip if it's already calculated
        if self.dominant_color:
            return
        try:
            # Resize image to speed up processing
            img = Image.open(self.square_thumbnail_small.path)
            img.thumbnail((100, 100))

            # Reduce colors (uses k-means internally)
            paletted = img.convert("P", palette=Image.ADAPTIVE, colors=palette_size)

            # Find the color that occurs most often
            palette = paletted.getpalette()
            color_counts = sorted(paletted.getcolors(), reverse=True)
            palette_index = color_counts[0][1]
            dominant_color = palette[palette_index * 3 : palette_index * 3 + 3]
            self.dominant_color = dominant_color
            self.save()
        except Exception:
            logger.info(f"Cannot calculate dominant color {self} object")


_THUMBNAIL_FILE_FIELDS = (
    "thumbnail_big",
    "square_thumbnail",
    "square_thumbnail_small",
)


def _is_thumbnail_file_referenced(name):
    """Return True if a remaining Thumbnail or Photo still uses ``name``.

    Thumbnail files are named by ``image_hash`` and are not owned by a single
    row: a Photo that is removed keeps its image_hash, and a re-added file with
    the same hash reuses the existing files instead of regenerating them. A
    Photo without a Thumbnail row yet (mid-scan) would also pick them up, so
    the Photo check covers the window before its Thumbnail is saved.
    """
    if Thumbnail.objects.filter(
        models.Q(thumbnail_big=name)
        | models.Q(square_thumbnail=name)
        | models.Q(square_thumbnail_small=name)
    ).exists():
        return True
    image_hash = os.path.splitext(os.path.basename(name))[0]
    return Photo.objects.filter(image_hash=image_hash).exists()


def _delete_orphaned_thumbnail_files(files):
    for storage, name in files:
        try:
            if _is_thumbnail_file_referenced(name):
                continue
            storage.delete(name)
        except (OSError, SuspiciousFileOperation) as e:
            # The rows are already gone; a file we cannot remove must not
            # fail the job that deleted them.
            logger.warning(f"could not delete orphaned thumbnail file {name}: {e}")


@receiver(models.signals.post_delete, sender=Thumbnail)
def delete_orphaned_thumbnail_files(sender, instance, using, **kwargs):
    """Remove a deleted Thumbnail's files once nothing else references them.

    Deferred to on_commit so a rolled-back delete keeps its files, and so the
    "still referenced?" check sees the committed state of the whole delete.
    """
    files = [
        (field_file.storage, field_file.name)
        for field_file in (getattr(instance, f) for f in _THUMBNAIL_FILE_FIELDS)
        if field_file and field_file.name
    ]
    if files:
        transaction.on_commit(
            partial(_delete_orphaned_thumbnail_files, files), using=using
        )
