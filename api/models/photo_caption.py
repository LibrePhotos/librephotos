from django.conf import settings
from django.db import models
from django.db.models import Q

import api.models
from api import util
from api.image_captioning import generate_caption
from api.llm import generate_prompt
from api.models.user import User


def _llm_model_enabled(site_config):
    return str(site_config.LLM_MODEL).strip().lower() != "none"


class PhotoCaption(models.Model):
    """Model for handling image captions and related functionality"""

    photo = models.OneToOneField(
        "Photo",
        on_delete=models.CASCADE,
        related_name="caption_instance",
        primary_key=True,
    )
    captions_json = models.JSONField(blank=True, null=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "api_photo_caption"

    def __str__(self):
        return f"Captions for {self.photo.image_hash}"

    def _get_thumbnail_big_path(self):
        if not self.photo.thumbnail or not self.photo.thumbnail.thumbnail_big:
            util.logger.warning(
                f"No thumbnail available for photo {self.photo.image_hash}"
            )
            return None

        try:
            image_path = self.photo.thumbnail.thumbnail_big.path
        except Exception:
            util.logger.warning(
                f"Cannot access thumbnail path for photo {self.photo.image_hash}"
            )
            return None

        if not image_path:
            util.logger.warning(
                f"Thumbnail path is empty for photo {self.photo.image_hash}"
            )
            return None

        return image_path

    def generate_captions_im2txt(self, commit=True):
        """Generate captions for the photo using the active non-torch model."""
        util.logger.info("Generating captions with Im2txt")

        image_path = self._get_thumbnail_big_path()
        if not image_path:
            return False
        if self.captions_json is None:
            self.captions_json = {}
        captions = self.captions_json

        try:
            from constance import config as site_config

            captioning_model = str(site_config.CAPTIONING_MODEL).strip().lower()

            if captioning_model == "none":
                util.logger.info("Generating captions is disabled")
                return False

            if captioning_model != "smolvlm-256m":
                util.logger.warning(
                    "Unsupported legacy captioning model '%s'; using smolvlm-256m instead",
                    site_config.CAPTIONING_MODEL,
                )

            caption = generate_caption(image_path=image_path)
            if not caption:
                util.logger.warning(
                    f"Captioning service returned an empty caption for image {image_path}"
                )
                return False
            caption = caption.replace("<start>", "").replace("<end>", "").strip()

            settings = User.objects.get(username=self.photo.owner).llm_settings
            if _llm_model_enabled(site_config) and settings["enabled"]:
                face = api.models.Face.objects.filter(photo=self.photo).first()
                person_name = ""
                if face and settings["add_person"]:
                    person_name = " Person: " + face.person.name
                place = ""
                if (
                    self.photo.search_instance
                    and self.photo.search_instance.search_location
                    and settings["add_location"]
                ):
                    place = " Place: " + self.photo.search_instance.search_location
                keywords = ""
                if settings["add_keywords"]:
                    keywords = " and tags or keywords"
                prompt = (
                    "Q: Your task is to improve the following image caption: "
                    + caption
                    + ". You also know the following information about the image:"
                    + place
                    + person_name
                    + ". Stick as closely as possible to the caption, while replacing generic information with information you know about the image. Only output the caption"
                    + keywords
                    + ". \n A:"
                )
                util.logger.info(prompt)
                caption = generate_prompt(prompt)

            captions["im2txt"] = caption
            self.captions_json = captions
            self.recreate_search_captions()
            if commit:
                self.save()

            util.logger.info(
                f"generated caption for image {image_path} with SiteConfig {site_config.CAPTIONING_MODEL}: {caption}"
            )
            return True
        except Exception:
            util.logger.exception(
                f"could not generate im2txt captions for image {image_path}"
            )
            return False

    def save_user_caption(self, caption, commit=True):
        """Save user-provided caption"""
        image_path = self._get_thumbnail_big_path()
        if not image_path:
            return False

        try:
            caption = caption.replace("<start>", "").replace("<end>", "").strip()

            if self.captions_json is None:
                self.captions_json = {}
            self.captions_json["user_caption"] = caption
            self.recreate_search_captions()

            if commit:
                self.save()

            util.logger.info(
                f"saved captions for image {image_path}. caption: {caption}. captions_json: {self.captions_json}."
            )

            # Handle hashtags
            hashtags = [
                word
                for word in caption.split()
                if word.startswith("#") and len(word) > 1
            ]

            for hashtag in hashtags:
                album_thing = api.models.album_thing.get_album_thing(
                    title=hashtag,
                    owner=self.photo.owner,
                    thing_type="hashtag_attribute",
                )
                if (
                    album_thing.photos.filter(image_hash=self.photo.image_hash).count()
                    == 0
                ):
                    album_thing.photos.add(self.photo)
                    album_thing.save()

            for album_thing in api.models.album_thing.AlbumThing.objects.filter(
                Q(photos__in=[self.photo])
                & Q(thing_type="hashtag_attribute")
                & Q(owner=self.photo.owner)
            ).all():
                if album_thing.title not in caption:
                    album_thing.photos.remove(self.photo)
                    album_thing.save()
            return True
        except Exception:
            util.logger.exception(f"could not save captions for image {image_path}")
            return False

    def recreate_search_captions(self):
        """Recreate search captions - directly access PhotoSearch model"""
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=self.photo)
        search_instance.recreate_search_captions()
        search_instance.save()

    def generate_tag_captions(self, commit=True):
        """Generate tag captions using the active tagging model.

        Tags are stored per-model in captions_json and are never deleted when
        switching models -- only the active model's tags are generated / visible.
        """
        from constance import config as site_config

        tagging_model = str(site_config.TAGGING_MODEL).strip().lower()
        if tagging_model != "siglip2":
            util.logger.warning(
                "Unsupported legacy tagging model '%s'; using siglip2 instead",
                site_config.TAGGING_MODEL,
            )
            tagging_model = "siglip2"

        image_path = self._get_thumbnail_big_path()
        if not image_path:
            return

        # Skip if this photo already has tags from the active model
        if (
            self.captions_json is not None
            and self.captions_json.get(tagging_model) is not None
        ):
            return

        try:
            import requests

            confidence = self.photo.owner.confidence
            json_data = {
                "image_path": image_path,
                "confidence": confidence,
                "tagging_model": tagging_model,
            }
            response = requests.post(
                f"{settings.MULTIMODAL_INFERENCE_SERVER}/generate-tags",
                json=json_data,
            )

            if not response.ok:
                util.logger.warning(
                    f"Tag service returned status {response.status_code} "
                    f"for image {image_path}"
                )
                return

            try:
                response_json = response.json()
            except (ValueError, RuntimeError):
                util.logger.warning(
                    f"Tag service returned non-JSON response for image {image_path}"
                )
                return

            tags_result = response_json.get("tags")

            if tags_result is None:
                return
            if self.captions_json is None:
                self.captions_json = {}

            # Store under the model-specific key
            self.captions_json[tagging_model] = tags_result
            self.recreate_search_captions()

            if tagging_model == "siglip2":
                self._update_siglip2_album_things(tags_result)
            else:
                self._update_places365_album_things(tags_result)

            if commit:
                self.save()
            util.logger.info(
                f"generated {tagging_model} tags for image {image_path}."
            )
        except Exception as e:
            util.logger.exception(
                f"could not generate tags for image "
                f"{self.photo.main_file.path if self.photo.main_file else 'no main file'}"
            )
            raise e

    def _update_places365_album_things(self, res_places365):
        """Create/update AlbumThing entries for Places365 tags."""
        # Remove old album associations for this photo
        for album_thing in api.models.album_thing.AlbumThing.objects.filter(
            Q(photos__in=[self.photo])
            & (
                Q(thing_type="places365_attribute")
                | Q(thing_type="places365_category")
            )
            & Q(owner=self.photo.owner)
        ).all():
            album_thing.photos.remove(self.photo)
            album_thing.save()

        if "attributes" in res_places365:
            for attribute in res_places365["attributes"]:
                album_thing = api.models.album_thing.get_album_thing(
                    title=attribute,
                    owner=self.photo.owner,
                    thing_type="places365_attribute",
                )
                album_thing.photos.add(self.photo)
                album_thing.save()

        if "categories" in res_places365:
            for category in res_places365["categories"]:
                album_thing = api.models.album_thing.get_album_thing(
                    title=category,
                    owner=self.photo.owner,
                    thing_type="places365_category",
                )
                album_thing.photos.add(self.photo)
                album_thing.save()

    def _update_siglip2_album_things(self, siglip2_result):
        """Create/update AlbumThing entries for SigLIP 2 tags."""
        tags = siglip2_result.get("tags", [])

        # Remove old siglip2 album associations for this photo
        for album_thing in api.models.album_thing.AlbumThing.objects.filter(
            Q(photos__in=[self.photo])
            & Q(thing_type="siglip2_tag")
            & Q(owner=self.photo.owner)
        ).all():
            album_thing.photos.remove(self.photo)
            album_thing.save()

        for tag in tags:
            album_thing = api.models.album_thing.get_album_thing(
                title=tag,
                owner=self.photo.owner,
                thing_type="siglip2_tag",
            )
            album_thing.photos.add(self.photo)
            album_thing.save()

    # Backward-compatible alias
    def generate_places365_captions(self, commit=True):
        return self.generate_tag_captions(commit=commit)
