import logging
import os
from functools import partial

from django.conf import settings
from django.db import models, transaction
from django.dispatch import receiver
from PIL import Image

from api.models.photo import Photo
from api.thumbnails import (
    create_animated_thumbnail,
    create_static_thumbnails,
    create_thumbnail_for_video,
    does_static_thumbnail_exist,
    does_video_thumbnail_exist,
)

logger = logging.getLogger(__name__)

# Static thumbnails are webp; the animated ones videos get instead are mp4.
STATIC_THUMBNAIL_DIRS = (
    "thumbnails_big",
    "square_thumbnails",
    "square_thumbnails_small",
)
ANIMATED_THUMBNAIL_DIRS = ("square_thumbnails", "square_thumbnails_small")


# Where a rebuild keeps the thumbnails it replaces until the new ones exist.
SET_ASIDE_SUFFIX = ".previous"


def thumbnail_file_paths(photo_hash: str) -> list[str]:
    """Every path a thumbnail named after ``photo_hash`` can have."""
    named = [(d, ".webp") for d in STATIC_THUMBNAIL_DIRS]
    named += [(d, ".mp4") for d in ANIMATED_THUMBNAIL_DIRS]
    return [
        os.path.join(settings.MEDIA_ROOT, output_dir, photo_hash + extension)
        for output_dir, extension in named
    ]


def delete_thumbnail_files(photo_hash: str) -> None:
    """Remove every thumbnail file named after ``photo_hash``."""
    for path in thumbnail_file_paths(photo_hash):
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                logger.error(f"could not remove thumbnail {path}")


def _put_back(set_aside):
    """Return set-aside thumbnails to their places, over anything made since."""
    for path, previous in set_aside:
        try:
            os.replace(previous, path)
        except OSError:
            logger.error(f"could not restore thumbnail {path} from {previous}")


def _set_aside_thumbnail_files(photo_hash: str) -> list[tuple[str, str]]:
    """Move ``photo_hash``'s thumbnails out of the way; return (path, moved to).

    Renamed next to themselves, not deleted, so that a rebuild that fails can
    put them back. A file that cannot be moved puts back the ones already moved
    and raises, leaving everything as it was.

    One already set aside was left by a rebuild whose worker was killed before
    it could put it back. It is the last complete thumbnail, where whatever is
    at ``path`` may be what ffmpeg had half written, so it goes back first.
    That holds only while one worker rebuilds a video at a time. Nothing locks
    it: a full rescan leaves the videos a running Probe Videos job has listed
    to that job, which skips the ones probed since it listed them, but two
    Probe Videos jobs at once are not kept apart.
    """
    set_aside = []
    for path in thumbnail_file_paths(photo_hash):
        previous = path + SET_ASIDE_SUFFIX
        if os.path.exists(previous):
            try:
                os.replace(previous, path)
            except OSError:
                _put_back(set_aside)
                raise
        if not os.path.exists(path):
            continue
        try:
            os.replace(path, previous)
        except OSError:
            _put_back(set_aside)
            raise
        set_aside.append((path, previous))
    return set_aside


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
            if not self.photo.video:
                missing = [
                    output_path
                    for output_path in STATIC_THUMBNAIL_DIRS
                    if not does_static_thumbnail_exist(output_path, photo_hash)
                ]
                if missing:
                    create_static_thumbnails(
                        input_path=self.photo.main_file.path,
                        hash=photo_hash,
                        output_paths=missing,
                        local_orientation=local_orientation,
                    )
            elif not does_static_thumbnail_exist("thumbnails_big", photo_hash):
                create_thumbnail_for_video(
                    input_path=self.photo.main_file.path,
                    output_path="thumbnails_big",
                    hash=photo_hash,
                    file_type=".webp",
                    transfer=self.photo.video_color_transfer,
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
                    transfer=self.photo.video_color_transfer,
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
                    transfer=self.photo.video_color_transfer,
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

    def _regenerate_thumbnails(self, keep_old_on_failure: bool = False) -> None:
        """Delete all existing thumbnail files and regenerate them.

        Picks up ``photo.local_orientation`` automatically via
        ``_generate_thumbnail``.  Should be called after updating
        ``Photo.local_orientation``.

        ``keep_old_on_failure`` is for a rebuild whose old thumbnails still show
        the right picture, only worse -- a video's washed-out HDR or unplayable
        10-bit ones. They are set aside rather than deleted, and if ffmpeg then
        fails they are put back: a washed-out thumbnail beats none at all. A
        rotation or a rewritten file leaves the old ones showing a picture that
        is no longer the photo's, so those still start from nothing.
        """
        if not keep_old_on_failure:
            delete_thumbnail_files(self.photo.image_hash)
            self._generate_thumbnail()
        else:
            set_aside = _set_aside_thumbnail_files(self.photo.image_hash)
            try:
                self._generate_thumbnail()
            except Exception:
                _put_back(set_aside)
                raise
            for _, previous in set_aside:
                try:
                    os.remove(previous)
                except OSError:
                    logger.error(f"could not remove old thumbnail {previous}")
            # Only these change the colours of the picture: a rotation keeps
            # them, and a rewritten file has had its colour cleared already.
            self._refresh_dominant_color()

        self._calculate_aspect_ratio()
        self._refresh_perceptual_hash()

    def _refresh_dominant_color(self) -> None:
        """Sample the placeholder colour again from the thumbnails just built.

        ``_get_dominant_color`` keeps a colour once set, so a washed-out HDR
        video rebuilt tonemapped would keep the desaturated one. A colour that
        cannot be sampled again is cleared: the neutral placeholder, not the
        old rendering's.
        """
        self.dominant_color = None
        self._get_dominant_color()
        if self.dominant_color is None:
            self.save(update_fields=["dominant_color"])

    def _refresh_perceptual_hash(self) -> None:
        """Re-read the photo's perceptual hash from the thumbnail just built.

        The scan compares this against the file on disk to tell a rewritten
        file from a replaced one, so a stale value left behind by a rotation
        would cost the photo its faces on the next scan.
        """
        from api.perceptual_hash import calculate_hash_from_thumbnail

        if not self.thumbnail_big or not os.path.exists(self.thumbnail_big.path):
            return
        phash = calculate_hash_from_thumbnail(self.thumbnail_big.path)
        if not phash:
            return
        self.photo.perceptual_hash = phash
        self.photo.save(save_metadata=False, update_fields=["perceptual_hash"])

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
            # A video's square thumbnails are mp4 clips, which PIL cannot open,
            # so videos never got a colour; their big thumbnail is a still.
            source = (
                self.thumbnail_big if self.photo.video else self.square_thumbnail_small
            )
            with Image.open(source.path) as img:
                # Resize image to speed up processing
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


def _delete_orphaned_thumbnail_files(file_names):
    """Delete the thumbnail files of a deleted Thumbnail nothing else uses.

    Thumbnail files are named by ``image_hash`` and are not owned by a single
    row: a removed Photo keeps its image_hash, and a re-added file with the
    same hash reuses the existing files instead of regenerating them. A Photo
    whose Thumbnail row is not saved yet (mid-scan) picks them up too, so any
    remaining Photo with the hash keeps the files, as does any Thumbnail row
    still pointing at one of them.
    """
    if Thumbnail.objects.filter(
        models.Q(thumbnail_big__in=file_names)
        | models.Q(square_thumbnail__in=file_names)
        | models.Q(square_thumbnail_small__in=file_names)
    ).exists():
        return
    photo_hashes = {os.path.splitext(os.path.basename(n))[0] for n in file_names}
    for photo_hash in photo_hashes:
        if not Photo.objects.filter(image_hash=photo_hash).exists():
            # Swallows OSError per file, so an unremovable file never fails
            # the job that deleted the rows.
            delete_thumbnail_files(photo_hash)


@receiver(models.signals.post_delete, sender=Thumbnail)
def delete_orphaned_thumbnail_files(sender, instance, using, **kwargs):
    """Remove a deleted Thumbnail's files once nothing else references them.

    Deferred to on_commit so a rolled-back delete keeps its files, and so the
    "still referenced?" check sees the committed state of the whole delete.
    """
    file_names = [
        field_file.name
        for field_file in (
            instance.thumbnail_big,
            instance.square_thumbnail,
            instance.square_thumbnail_small,
        )
        if field_file and field_file.name
    ]
    if file_names:
        transaction.on_commit(
            partial(_delete_orphaned_thumbnail_files, file_names), using=using
        )
