import logging
import re
import unicodedata
from typing import Any

from django.core.exceptions import ObjectDoesNotExist
from django.db import models

logger = logging.getLogger(__name__)

# The combining diacritical mark blocks (accents, cedillas, rings, carons...).
# Only these are dropped: the marks of Indic scripts, Japanese dakuten and the
# like change the letter, so stripping them would make unrelated words match.
_DIACRITICS = re.compile(
    "[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]"
)
# Latin letters that carry their stroke inside the code point, so that NFKD has
# no mark to split off. The frontend's foldText uses the same table.
_UNSPLIT_LETTERS = str.maketrans(
    {"ø": "o", "ł": "l", "đ": "d", "ħ": "h", "ı": "i", "ŧ": "t", "æ": "ae", "œ": "oe"}
)


def fold(text: str) -> str:
    """``text`` without case or diacritics, for accent-insensitive search.

    "Zürich" and "ZURICH" both fold to "zurich", "Łódź" to "lodz" and "Straße"
    to "strasse". Compatibility forms fold too (the "ﬁ" ligature to "fi").
    NFC afterwards puts Hangul syllables and kana back together, so text in
    scripts without Latin accents only loses its case.
    """
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    stripped = _DIACRITICS.sub("", decomposed).translate(_UNSPLIT_LETTERS)
    return unicodedata.normalize("NFC", stripped)


def place_label(geolocation_json: dict[str, Any] | None) -> str:
    """The place name of a reverse-geocode result, as search stores it.

    The provider's ``address`` when there is one, else the names of its
    ``features`` joined by commas; "" without either. The location picker
    shows the same text before saving (``GET /api/geocode/reverse``).
    """
    if not geolocation_json:
        return ""
    if "address" in geolocation_json:
        return str(geolocation_json["address"])
    features = geolocation_json.get("features") or []
    return ", ".join(
        str(feature["text"]) for feature in features if feature.get("text")
    )


class PhotoSearch(models.Model):
    """Model for handling photo search functionality"""

    photo = models.OneToOneField(
        "Photo",
        on_delete=models.CASCADE,
        related_name="search_instance",
        primary_key=True,
    )
    search_captions = models.TextField(blank=True, null=True, db_index=True)
    search_location = models.TextField(blank=True, null=True, db_index=True)
    # fold() of the captions and the location, kept in step by the two methods
    # below, so a search for "Zurich" or "cafe" finds "Zürich" and "café" (#659)
    # on every database without Postgres' unaccent extension. No index: it is
    # only ever matched with icontains, which cannot use one.
    search_folded = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "api_photo_search"

    def __str__(self) -> str:
        return f"Search data for {self.photo.image_hash}"

    def recreate_search_captions(self) -> None:
        """Recreate search captions from all caption sources.

        Only OpenCLIP's tags are indexed into search_captions: tags an earlier
        tagger left under its own key are not.
        """
        from api.search.semantic import OPENCLIP

        search_captions = ""

        # Get captions from the PhotoCaption model. A photo without a caption row
        # raises on the reverse one-to-one; that means there is nothing to add.
        try:
            caption_instance = self.photo.caption_instance
        except ObjectDoesNotExist:
            caption_instance = None
        if caption_instance:
            captions_json = caption_instance.captions_json
            if captions_json:
                # The tagger stores {"tags": [...]} under its model's key.
                tags = (captions_json.get(OPENCLIP) or {}).get("tags", [])
                if tags:
                    search_captions += " ".join(tags) + " "

                user_caption = captions_json.get("user_caption", "")
                if user_caption:
                    search_captions += user_caption + " "

                im2txt_caption = captions_json.get("im2txt", "")
                if im2txt_caption:
                    search_captions += im2txt_caption + " "

        # Add face/person names. Go through the related manager so a caller that
        # already prefetched the faces (and their people) does not pay a query
        # per photo and per face here. A deleted face keeps its person, so it
        # is skipped here rather than filtered out of that prefetch.
        for face in self.photo.faces.all():
            if face.person and not face.deleted:
                search_captions += face.person.name + " "

        # Add file paths
        if self.photo.main_file:
            search_captions += self.photo.main_file.path + " "
        for file in self.photo.files.all():
            search_captions += file.path + " "

        # Add media type
        if self.photo.video:
            search_captions += "type: video "
        if self.photo.is_screenshot:
            search_captions += "type: screenshot "
        if self.photo.is_document:
            search_captions += "type: document "

        # Add camera and lens info from PhotoMetadata
        try:
            metadata = self.photo.metadata
            if metadata.camera_display:
                search_captions += metadata.camera_display + " "
            if metadata.lens_display:
                search_captions += metadata.lens_display + " "
            if metadata.keywords:
                search_captions += " ".join(str(k) for k in metadata.keywords) + " "
        except ObjectDoesNotExist:
            pass  # no PhotoMetadata row yet

        self.search_captions = search_captions.strip()
        self.refresh_search_folded()

        logger.debug("Recreated search captions for image %s.", self.photo.image_hash)

    def update_search_location(self, geolocation_json: dict[str, Any] | None) -> None:
        """Update search location from geolocation data"""
        self.search_location = place_label(geolocation_json)
        self.refresh_search_folded()

        logger.debug(
            "Updated search location for image %s: %s",
            self.photo.image_hash,
            self.search_location,
        )

    def refresh_search_folded(self) -> None:
        """Fold the captions and the location into ``search_folded``."""
        self.search_folded = fold(
            " ".join(
                part for part in (self.search_captions, self.search_location) if part
            )
        )
