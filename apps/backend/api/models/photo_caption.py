from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.db import models
from django.db.models import Q

import api.models
from api import util
from api.image_captioning import generate_caption
from api.models.user import User


def tag_thing_type(tagging_model):
    """The AlbumThing.thing_type a tagging model files its tags under."""
    return f"{tagging_model}_tag"


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

    def _resolve_thumbnail_path(self):
        """Path of the big thumbnail, or None when it is missing or unreadable"""
        if not self.photo.thumbnail or not self.photo.thumbnail.thumbnail_big:
            util.logger.warning(
                f"No thumbnail available for photo {self.photo.image_hash}"
            )
            return None

        try:
            return self.photo.thumbnail.thumbnail_big.path
        except Exception:
            util.logger.warning(
                f"Cannot access thumbnail path for photo {self.photo.image_hash}"
            )
            return None

    def _caption_context(self, llm_settings):
        """(person name, location, keywords flag) for prompting, or None if off.

        The user's caption-context switches (``llm_settings``, a historical
        name) decide what the caption may know about the photo. The captioning
        model takes that context in its prompt directly.
        """
        if not llm_settings["enabled"]:
            return None

        person_name = None
        if llm_settings["add_person"]:
            face = (
                api.models.Face.objects.filter(photo=self.photo, person__isnull=False)
                .select_related("person")
                .first()
            )
            person_name = face.person.name if face else None

        location = None
        if llm_settings["add_location"]:
            # A photo that has not been through the scan yet has no search row.
            try:
                search_instance = self.photo.search_instance
            except ObjectDoesNotExist:
                search_instance = None
            if search_instance and search_instance.search_location:
                location = search_instance.search_location

        return person_name, location, llm_settings["add_keywords"]

    @staticmethod
    def _caption_prompt(context):
        """The prompt for the vision-language captioner, with what we know."""
        if context is None:
            return "Describe this image in a short, natural image caption."

        person_name, location, add_keywords = context
        person = ""
        if person_name is not None:
            person = (
                f" The person in the photo is named {person_name}. "
                f"Use the name '{person_name}' directly in the caption — do not say 'a person named'. "
                f"Keep the caption casual and to the point, like a friend tagging a photo."
            )
        place = f" This photo was taken at {location}." if location is not None else ""
        keywords = " Include relevant tags and keywords." if add_keywords else ""
        return "Write a short, natural image caption." + person + place + keywords

    def _store_generated_caption(self, captions, caption, commit):
        # Historical key: every generated caption, whichever model wrote it,
        # lives under "im2txt" so the search index and the clients keep
        # finding it.
        captions["im2txt"] = caption
        self.captions_json = captions
        self.recreate_search_captions()
        if commit:
            self.save()

    def generate_captions_im2txt(self, commit=True):
        """Generate a caption for the photo with the captioning sidecar.

        The name is historical (im2txt was the first model). The prompt
        carries the recognised person and the place when the user's caption
        settings allow it.
        """
        if not settings.FEATURE_IMAGE_CAPTIONING:
            util.logger.info("Image captioning is disabled")
            return False

        image_path = self._resolve_thumbnail_path()
        if image_path is None:
            return False

        if self.captions_json is None:
            self.captions_json = {}
        captions = self.captions_json

        try:
            from constance import config as site_config

            if str(site_config.CAPTIONING_MODEL).lower() == "none":
                util.logger.info("Generating captions is disabled")
                return False

            llm_settings = User.objects.get(username=self.photo.owner).llm_settings
            context = self._caption_context(llm_settings)
            prompt = self._caption_prompt(context)
            util.logger.info(f"Caption prompt: {prompt}")

            caption = generate_caption(image_path=image_path, prompt=prompt)
            caption = caption.replace("<start>", "").replace("<end>", "").strip()

            self._store_generated_caption(captions, caption, commit)

            util.logger.info(f"generated caption for image {image_path}: {caption}")
            return True
        except Exception:
            util.logger.exception(f"could not generate caption for image {image_path}")
            return False

    def save_user_caption(self, caption, commit=True):
        """Save user-provided caption"""
        image_path = self._resolve_thumbnail_path()
        if image_path is None:
            return False

        try:
            caption = self.apply_user_caption(caption, commit=commit)
            util.logger.info(
                f"saved captions for image {image_path}. caption: {caption}. captions_json: {self.captions_json}."
            )
            return True
        except Exception:
            util.logger.exception(f"could not save captions for image {image_path}")
            return False

    def apply_user_caption(self, caption, commit=True):
        """Set ``user_caption`` and everything that hangs off it.

        The single code path for the lightbox caption, whether the user typed it
        (``save_user_caption``) or it was imported from the file's description
        (``PhotoMetadata.extract_exif_data``): either way it is reindexed for
        search and its #hashtags are synced to hashtag albums. Unlike
        ``save_user_caption`` it needs no thumbnail and does not swallow
        errors. Returns the caption as stored.
        """
        caption = caption.replace("<start>", "").replace("<end>", "").strip()

        if self.captions_json is None:
            self.captions_json = {}
        self.captions_json["user_caption"] = caption
        self.recreate_search_captions()

        if commit:
            self.save()

        self._sync_hashtag_album_things(caption)
        return caption

    def _photo_album_things(self, thing_types):
        """AlbumThings of the given types that own this photo, for this owner"""
        return api.models.album_thing.AlbumThing.objects.filter(
            Q(photos__in=[self.photo])
            & Q(thing_type__in=thing_types)
            & Q(owner=self.photo.owner)
        ).all()

    def _detach_photo_from_album_things(self, thing_types):
        for album_thing in self._photo_album_things(thing_types):
            album_thing.photos.remove(self.photo)
            album_thing.save()

    def _attach_photo_to_album_things(self, titles, thing_type):
        for title in titles:
            album_thing = api.models.album_thing.get_album_thing(
                title=title,
                owner=self.photo.owner,
                thing_type=thing_type,
            )
            album_thing.photos.add(self.photo)
            album_thing.save()

    def _sync_hashtag_album_things(self, caption):
        """Add album things for hashtags in the caption, drop the ones gone from it"""
        hashtags = [
            word for word in caption.split() if word.startswith("#") and len(word) > 1
        ]

        for hashtag in hashtags:
            album_thing = api.models.album_thing.get_album_thing(
                title=hashtag,
                owner=self.photo.owner,
                thing_type="hashtag_attribute",
            )
            if album_thing.photos.filter(image_hash=self.photo.image_hash).count() == 0:
                album_thing.photos.add(self.photo)
                album_thing.save()

        for album_thing in self._photo_album_things(["hashtag_attribute"]):
            if album_thing.title not in caption:
                album_thing.photos.remove(self.photo)
                album_thing.save()

    def recreate_search_captions(self):
        """Recreate search captions - directly access PhotoSearch model"""
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=self.photo)
        search_instance.recreate_search_captions()
        search_instance.save()

    def generate_tag_captions(self, commit=True):
        """Generate tags with the active tagging model (MobileCLIP-S2 or SigLIP 2).

        Tags are stored per-model in captions_json and are never deleted when
        switching models -- only the active model's tags are generated / visible.
        """
        if not settings.FEATURE_SCENE_CLASSIFICATION:
            util.logger.info("Scene classification is disabled")
            return

        from constance import config as site_config

        tagging_model = site_config.TAGGING_MODEL

        if not self.photo.thumbnail or not self.photo.thumbnail.thumbnail_big:
            return

        # Skip if this photo already has tags from the active model
        if (
            self.captions_json is not None
            and self.captions_json.get(tagging_model) is not None
        ):
            return

        try:
            import requests

            from api.http_timeouts import TAGS

            image_path = self.photo.thumbnail.thumbnail_big.path
            confidence = self.photo.owner.confidence
            json_data = {
                "image_path": image_path,
                "confidence": confidence,
                "tagging_model": tagging_model,
            }
            response = requests.post(
                "http://localhost:8011/generate-tags", json=json_data, timeout=TAGS
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
            self._update_tag_album_things(tags_result, tagging_model)

            if commit:
                self.save()
            util.logger.info(f"generated {tagging_model} tags for image {image_path}.")
        except Exception as e:
            util.logger.exception(
                f"could not generate tags for image "
                f"{self.photo.main_file.path if self.photo.main_file else 'no main file'}"
            )
            raise e

    def _update_tag_album_things(self, tag_result, tagging_model):
        """Replace this photo's AlbumThing memberships for one tagging model."""
        thing_type = tag_thing_type(tagging_model)
        tags = (tag_result or {}).get("tags", [])

        self._detach_photo_from_album_things([thing_type])
        self._attach_photo_to_album_things(tags, thing_type)

    # Backward-compatible alias
    def generate_places365_captions(self, commit=True):
        return self.generate_tag_captions(commit=commit)
