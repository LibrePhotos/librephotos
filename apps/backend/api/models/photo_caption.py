from django.db import models
from django.db.models import Q

import api.models
from api import util
from api.image_captioning import generate_caption
from api.llm import generate_prompt
from api.models.user import User


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

    def generate_captions_im2txt(self, commit=True):
        """Generate im2txt captions for the photo"""
        if not self.photo.thumbnail or not self.photo.thumbnail.thumbnail_big:
            util.logger.warning(
                f"No thumbnail available for photo {self.photo.image_hash}"
            )
            return False

        image_path = self.photo.thumbnail.thumbnail_big.path
        if self.captions_json is None:
            self.captions_json = {}
        captions = self.captions_json

        try:
            from constance import config as site_config

            if site_config.CAPTIONING_MODEL == "None":
                util.logger.info("Generating captions is disabled")
                return False

            if site_config.CAPTIONING_MODEL == "moondream":
                return self._generate_captions_moondream(commit=commit)

            blip = False
            if site_config.CAPTIONING_MODEL == "blip_base_capfilt_large":
                blip = True

            caption = generate_caption(image_path=image_path, blip=blip)
            caption = caption.replace("<start>", "").replace("<end>", "").strip()

            settings = User.objects.get(username=self.photo.owner).llm_settings
            if site_config.LLM_MODEL != "None" and settings["enabled"]:
                face = api.models.Face.objects.filter(photo=self.photo).first()
                person_name = ""
                if face and settings["add_person"]:
                    person_name = " Person: " + face.person.name
                place = ""
                if self.photo.search_location and settings["add_location"]:
                    place = " Place: " + self.photo.search_location
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
                caption = generate_prompt(prompt, image_path=image_path)

            captions["im2txt"] = caption
            self.captions_json = captions
            self.recreate_search_captions()
            if commit:
                self.save()

            util.logger.info(
                f"generated im2txt captions for image {image_path} with SiteConfig {site_config.CAPTIONING_MODEL} with Blip: {blip} caption: {caption}"
            )
            return True
        except Exception:
            util.logger.exception(
                f"could not generate im2txt captions for image {image_path}"
            )
            return False

    def _generate_captions_moondream(self, commit=True):
        """Generate captions using Moondream with enhanced prompt"""
        if not self.photo.thumbnail or not self.photo.thumbnail.thumbnail_big:
            util.logger.warning(
                f"No thumbnail available for photo {self.photo.image_hash}"
            )
            return False

        image_path = self.photo.thumbnail.thumbnail_big.path
        if self.captions_json is None:
            self.captions_json = {}
        captions = self.captions_json

        try:
            from constance import config as site_config
            from api.image_captioning import generate_caption

            util.logger.info("Generating Moondream captions")

            settings = User.objects.get(username=self.photo.owner).llm_settings

            # Default prompt
            prompt = "Describe this image in a short, natural image caption."

            # Enhanced prompting if LLM is enabled
            if site_config.LLM_MODEL != "None" and settings["enabled"]:
                face = api.models.Face.objects.filter(photo=self.photo).first()
                person_name = ""
                if face and settings["add_person"]:
                    person_name = (
                        f" The person in the photo is named {face.person.name}. "
                        f"Use the name '{face.person.name}' directly in the caption — do not say 'a person named'. "
                        f"Keep the caption casual and to the point, like a friend tagging a photo."
                    )

                place = ""
                if self.photo.search_location and settings["add_location"]:
                    place = f" This photo was taken at {self.photo.search_location}."

                keywords_instruction = ""
                if settings["add_keywords"]:
                    keywords_instruction = " Include relevant tags and keywords."

                prompt = (
                    "Write a short, natural image caption."
                    + person_name
                    + place
                    + keywords_instruction
                )

            util.logger.info(f"Moondream prompt: {prompt}")

            # Generate caption with the final prompt
            caption = generate_caption(image_path=image_path, prompt=prompt)
            caption = caption.replace("<start>", "").replace("<end>", "").strip()

            # Save the result
            captions["im2txt"] = caption
            self.captions_json = captions
            self.recreate_search_captions()
            if commit:
                self.save()

            util.logger.info(
                f"Generated Moondream captions for image {image_path}, caption: {caption}"
            )
            return True
        except Exception:
            util.logger.exception(
                f"Could not generate Moondream captions for image {image_path}"
            )
            return False

    def save_user_caption(self, caption, commit=True):
        """Save user-provided caption"""
        if not self.photo.thumbnail or not self.photo.thumbnail.thumbnail_big:
            util.logger.warning(
                f"No thumbnail available for photo {self.photo.image_hash}"
            )
            return False

        image_path = self.photo.thumbnail.thumbnail_big.path
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
                Q(photos__in=[self.photo.image_hash])
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
        """Recreate search captions - delegates to PhotoSearch model"""
        search_instance = self.photo._get_or_create_search_instance()
        search_instance.recreate_search_captions()
        search_instance.save()

    def generate_places365_captions(self, commit=True):
        """Generate places365 captions"""
        if (
            self.captions_json is not None
            and self.captions_json.get("places365") is not None
            or not self.photo.thumbnail
            or not self.photo.thumbnail.thumbnail_big
        ):
            return

        try:
            import requests

            image_path = self.photo.thumbnail.thumbnail_big.path
            confidence = self.photo.owner.confidence
            json_data = {
                "image_path": image_path,
                "confidence": confidence,
            }
            res_places365 = requests.post(
                "http://localhost:8011/generate-tags", json=json_data
            ).json()["tags"]

            if res_places365 is None:
                return
            if self.captions_json is None:
                self.captions_json = {}

            self.captions_json["places365"] = res_places365
            self.recreate_search_captions()

            # Remove old album associations
            for album_thing in api.models.album_thing.AlbumThing.objects.filter(
                Q(photos__in=[self.photo.image_hash])
                & (
                    Q(thing_type="places365_attribute")
                    or Q(thing_type="places365_category")
                )
                & Q(owner=self.photo.owner)
            ).all():
                album_thing.photos.remove(self.photo)
                album_thing.save()

            # Add new album associations
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

            if commit:
                self.save()
            util.logger.info(f"generated places365 captions for image {image_path}.")
        except Exception as e:
            util.logger.exception(
                f"could not generate captions for image {self.photo.main_file.path if self.photo.main_file else 'no main file'}"
            )
            raise e
