from django.db import models
from PIL import Image
from api.models.photo import Photo
from api.thumbnails import (
    create_animated_thumbnail,
    create_thumbnail,
    create_thumbnail_for_video,
    does_static_thumbnail_exist,
    does_video_thumbnail_exist,
)
from api.util import get_metadata, logger
from api.exif_tags import Tags
import os


class Thumbnail(models.Model):
    photo = models.OneToOneField(
        Photo,
        on_delete=models.CASCADE,
        related_name='thumbnail',
        primary_key=True
    )
    thumbnail_big = models.ImageField(upload_to="thumbnails_big")
    square_thumbnail = models.ImageField(upload_to="square_thumbnails")
    square_thumbnail_small = models.ImageField(upload_to="square_thumbnails_small")
    aspect_ratio = models.FloatField(blank=True, null=True)
    dominant_color = models.TextField(blank=True, null=True)

    def _generate_thumbnail(self, commit=True):
        try:
            if not does_static_thumbnail_exist("thumbnails_big", self.photo.image_hash):
                if not self.photo.video:
                    create_thumbnail(
                        input_path=self.photo.main_file.path,
                        output_height=1080,
                        output_path="thumbnails_big",
                        hash=self.photo.image_hash,
                        file_type=".webp",
                    )
                else:
                    create_thumbnail_for_video(
                        input_path=self.photo.main_file.path,
                        output_path="thumbnails_big",
                        hash=self.photo.image_hash,
                        file_type=".webp",
                    )

            if not self.photo.video and not does_static_thumbnail_exist(
                "square_thumbnails", self.photo.image_hash
            ):
                create_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=500,
                    output_path="square_thumbnails",
                    hash=self.photo.image_hash,
                    file_type=".webp",
                )
            if self.photo.video and not does_video_thumbnail_exist(
                "square_thumbnails", self.photo.image_hash
            ):
                create_animated_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=500,
                    output_path="square_thumbnails",
                    hash=self.photo.image_hash,
                    file_type=".mp4",
                )

            if not self.photo.video and not does_static_thumbnail_exist(
                "square_thumbnails_small", self.photo.image_hash
            ):
                create_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=250,
                    output_path="square_thumbnails_small",
                    hash=self.photo.image_hash,
                    file_type=".webp",
                )
            if self.photo.video and not does_video_thumbnail_exist(
                "square_thumbnails_small", self.photo.image_hash
            ):
                create_animated_thumbnail(
                    input_path=self.photo.main_file.path,
                    output_height=250,
                    output_path="square_thumbnails_small",
                    hash=self.photo.image_hash,
                    file_type=".mp4",
                )
            filetype = ".webp"
            if self.photo.video:
                filetype = ".mp4"
            self.thumbnail_big.name = os.path.join(
                "thumbnails_big", self.photo.image_hash + ".webp"
            ).strip()
            self.square_thumbnail.name = os.path.join(
                "square_thumbnails", self.photo.image_hash + filetype
            ).strip()
            self.square_thumbnail_small.name = os.path.join(
                "square_thumbnails_small", self.photo.image_hash + filetype
            ).strip()
            if commit:
                self.save()
        except Exception as e:
            logger.exception(
                f"could not generate thumbnail for image {self.photo.main_file.path}"
            )
            raise e

    def _calculate_aspect_ratio(self, commit=True):
        try:
            # Relies on big thumbnail for correct aspect ratio
            height, width = get_metadata(
                self.thumbnail_big.path,
                tags=[Tags.IMAGE_HEIGHT, Tags.IMAGE_WIDTH],
                try_sidecar=False,
            )
            self.aspect_ratio = round(width / height, 2)

            if commit:
                self.save()
        except Exception as e:
            logger.exception(
                f"could not calculate aspect ratio for image {self.thumbnail_big.path}"
            )
            raise e

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