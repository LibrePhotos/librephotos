"""
Integration test for XMP description extraction.

Tests the full pipeline of reading XMP:Description from a real XMP sidecar
(api/tests/fixtures/niaz.xmp) using exiftool, storing it in
PhotoMetadata.caption, and seeding the lightbox caption in
PhotoCaption.captions_json["user_caption"].

The sidecar path is what matters here: niaz.jpg carries no embedded
description of its own, so anything that turns up had to come out of the
sidecar next to it. That is the shape every tool writing dc:description
produces - exiftool, digiKam, Lightroom - and the lang-alt in the fixture
resolves down to its x-default entry, which is what ExifTool hands back.
"""

import os
import shutil
import tempfile
import unittest
import uuid
from unittest.mock import patch

import exiftool
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import File, Photo
from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import EXIF_VALUE_NAMES, PhotoMetadata
from api.models.photo_search import PhotoSearch
from api.models.thumbnail import Thumbnail
from api.tests.utils import create_test_photo, create_test_user

FIXTURES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
)
NIAZ_IMAGE = os.path.join(FIXTURES_DIR, "niaz.jpg")
NIAZ_SIDECAR = os.path.join(FIXTURES_DIR, "niaz.xmp")

# The x-default entry of dc:description in niaz.xmp.
EXPECTED_DESCRIPTION = (
    "American actor Niaz Faridani-Rad arrives on the red carpet for the "
    'premiere of the film "First Man" at the Smithsonian National Air and '
    "Space Museum Thursday, Oct. 4, 2018 in Washington. The film is based on "
    "the book by Jim Hansen, and chronicles the life of NASA astronaut Neil "
    "Armstrong from test pilot to his historic Moon landing. Photo Credit: "
    "(NASA/Aubrey Gemignani)"
)


def _exiftool_get_metadata(media_file, tags, try_sidecar=True, struct=False):
    """Call exiftool directly, bypassing the HTTP service.

    This mirrors the behaviour of ``service/exif/main.py`` but runs
    in-process so that tests do not need the Flask micro-service.
    """
    from api.metadata.reader import _get_existing_metadata_files_reversed

    files = _get_existing_metadata_files_reversed(media_file, try_sidecar)

    with exiftool.ExifTool() as et:
        values = []
        for tag in tags:
            value = None
            for f in files:
                retrieved = et.get_tag(tag, f)
                if retrieved is not None:
                    value = retrieved
            values.append(value)

    return values


class XMPDescriptionIntegrationTest(TestCase):
    """End-to-end test: XMP sidecar -> exiftool -> PhotoMetadata -> caption."""

    def setUp(self):
        self.user = create_test_user()
        # Copy the fixtures to /tmp so the test does not modify the repo copies.
        # The sidecar has to sit next to the photo under the same basename.
        self.tmp_name = str(uuid.uuid4())
        self.tmp_path = f"/tmp/{self.tmp_name}.jpg"
        self.tmp_sidecar = f"/tmp/{self.tmp_name}.xmp"
        shutil.copy2(NIAZ_IMAGE, self.tmp_path)
        shutil.copy2(NIAZ_SIDECAR, self.tmp_sidecar)

        pk = uuid.uuid4()
        image_hash = self.tmp_name[:32]
        self.photo = Photo(pk=pk, image_hash=image_hash, owner=self.user)
        file_obj = File.create(self.tmp_path, self.user)
        self.photo.main_file = file_obj
        self.photo.added_on = timezone.now()
        self.photo.save()

        Thumbnail.objects.create(
            photo=self.photo,
            thumbnail_big=f"thumbnails_big/{image_hash}.webp",
            aspect_ratio=1.0,
        )

    def tearDown(self):
        for path in (self.tmp_path, self.tmp_sidecar):
            if os.path.exists(path):
                os.remove(path)

    # -- helpers ----------------------------------------------------------

    def _extract_with_real_exiftool(self):
        """Run extract_exif_data with exiftool instead of the HTTP service."""
        with patch(
            "api.models.photo_metadata.get_metadata",
            side_effect=_exiftool_get_metadata,
        ):
            return PhotoMetadata.extract_exif_data(self.photo, commit=True)

    # -- tests ------------------------------------------------------------

    def test_image_itself_carries_no_description(self):
        """The fixture JPEG is bare, so the sidecar is the only source."""
        with exiftool.ExifTool() as et:
            self.assertIsNone(et.get_tag("XMP:Description", self.tmp_path))

    def test_extract_exif_data_reads_description_from_sidecar(self):
        """The sidecar's dc:description lands in PhotoMetadata.caption."""
        metadata = self._extract_with_real_exiftool()

        self.assertIsNotNone(metadata)
        self.assertEqual(metadata.caption, EXPECTED_DESCRIPTION)

    def test_description_seeds_the_lightbox_caption(self):
        """The description also reaches the caption the lightbox renders."""
        self._extract_with_real_exiftool()

        caption_instance = PhotoCaption.objects.get(photo=self.photo)
        self.assertEqual(
            caption_instance.captions_json["user_caption"], EXPECTED_DESCRIPTION
        )

    def test_rescan_does_not_overwrite_a_user_caption(self):
        """A caption the user typed survives the next scan."""
        self._extract_with_real_exiftool()

        caption_instance = PhotoCaption.objects.get(photo=self.photo)
        caption_instance.captions_json["user_caption"] = "what the user typed"
        caption_instance.save()

        self._extract_with_real_exiftool()

        caption_instance.refresh_from_db()
        self.assertEqual(
            caption_instance.captions_json["user_caption"], "what the user typed"
        )

    def test_description_is_searchable(self):
        """Seeding the caption also indexes it, so the text is searchable."""
        self._extract_with_real_exiftool()

        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertIn("Neil Armstrong", search.search_captions)

    def test_keywords_still_extracted_alongside_the_description(self):
        """Adding the description tag must not disturb the keyword merge."""
        metadata = self._extract_with_real_exiftool()

        self.assertIn("Niaz Faridani-Rad", metadata.keywords)

    def test_user_edited_metadata_caption_survives_rescan(self):
        """A caption edited through the metadata API is not reverted by a scan."""
        self._extract_with_real_exiftool()
        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"caption": "my own words"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        metadata = self._extract_with_real_exiftool()

        metadata.refresh_from_db()
        self.assertEqual(metadata.caption, "my own words")
        self.assertEqual(metadata.source, PhotoMetadata.Source.USER_EDIT)

    def test_revert_all_brings_the_file_description_back(self):
        """Revert all re-extracts, and the file's description wins again."""
        self._extract_with_real_exiftool()
        client = APIClient()
        client.force_authenticate(user=self.user)
        client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"caption": "my own words"},
            format="json",
        )

        with patch(
            "api.models.photo_metadata.get_metadata",
            side_effect=_exiftool_get_metadata,
        ):
            response = client.post(f"/api/photos/{self.photo.id}/metadata/revert-all")
        self.assertEqual(response.status_code, 200)

        metadata = PhotoMetadata.objects.get(photo=self.photo)
        self.assertEqual(metadata.caption, EXPECTED_DESCRIPTION)

    def test_cleared_caption_stays_cleared_on_rescan(self):
        """Clearing the imported lightbox caption is not undone by a rescan."""
        self._extract_with_real_exiftool()
        caption_instance = PhotoCaption.objects.get(photo=self.photo)
        self.assertTrue(caption_instance.save_user_caption(""))

        self._extract_with_real_exiftool()

        caption_instance.refresh_from_db()
        self.assertEqual(caption_instance.captions_json["user_caption"], "")


class DescriptionToCaptionTest(TestCase):
    """How a (mocked) file description reaches the lightbox caption."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def _extract(self, description=None, any_language=None):
        values = {
            "xmp_description": description,
            "xmp_description_any_language": any_language,
        }
        mock_values = [values.get(name) for name in EXIF_VALUE_NAMES]
        with patch("api.models.photo_metadata.get_metadata", return_value=mock_values):
            return PhotoMetadata.extract_exif_data(self.photo, commit=True)

    def _user_caption(self):
        return PhotoCaption.objects.get(photo=self.photo).captions_json.get(
            "user_caption"
        )

    def test_numeric_description_is_stored_as_text(self):
        """ExifTool returns a description of "2024" as the int 2024."""
        metadata = self._extract(description=2024)

        self.assertEqual(metadata.caption, "2024")
        self.assertEqual(self._user_caption(), "2024")
        # This used to TypeError on every rescan (str += int).
        search = PhotoSearch.objects.get(photo=self.photo)
        search.recreate_search_captions()
        self.assertIn("2024", search.search_captions)

    def test_blank_description_is_ignored(self):
        metadata = self._extract(description="   ")

        self.assertIsNone(metadata.caption)
        self.assertFalse(PhotoCaption.objects.filter(photo=self.photo).exists())

    def test_description_is_stripped(self):
        metadata = self._extract(description="  a dog on a beach \n")

        self.assertEqual(metadata.caption, "a dog on a beach")
        self.assertEqual(self._user_caption(), "a dog on a beach")

    def test_language_entry_is_the_fallback(self):
        metadata = self._extract(any_language="Ein Hund am Strand")

        self.assertEqual(metadata.caption, "Ein Hund am Strand")

    def test_x_default_wins_over_a_language_entry(self):
        metadata = self._extract(description="A dog", any_language="Ein Hund")

        self.assertEqual(metadata.caption, "A dog")

    def test_hashtags_in_the_description_become_hashtag_albums(self):
        """An imported caption behaves like a typed one, #hashtags included."""
        self._extract(description="beach day #sun #sea")

        albums = set(
            AlbumThing.objects.filter(
                thing_type="hashtag_attribute", owner=self.user, photos=self.photo
            ).values_list("title", flat=True)
        )
        self.assertEqual(albums, {"#sun", "#sea"})

    def test_changed_description_updates_an_untouched_caption(self):
        """A sidecar edited elsewhere follows through while the lightbox
        caption is still exactly what was imported."""
        self._extract(description="first version")
        self._extract(description="second version")

        self.assertEqual(self._user_caption(), "second version")

    def test_changed_description_keeps_a_typed_caption(self):
        self._extract(description="first version")
        PhotoCaption.objects.get(photo=self.photo).apply_user_caption("typed")

        self._extract(description="second version")

        self.assertEqual(self._user_caption(), "typed")

    def test_existing_caption_is_kept_on_first_import(self):
        """A caption typed before the photo ever had a description wins."""
        PhotoCaption.objects.create(
            photo=self.photo, captions_json={"user_caption": "typed earlier"}
        )

        self._extract(description="from the file")

        self.assertEqual(self._user_caption(), "typed earlier")


LANG_ALT_ONLY_SIDECAR = """<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/'>
<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
 <rdf:Description rdf:about='' xmlns:dc='http://purl.org/dc/elements/1.1/'>
  <dc:description><rdf:Alt>
   <rdf:li xml:lang='de'>Ein Hund am Strand</rdf:li>
   <rdf:li xml:lang='fr'>Un chien sur la plage</rdf:li>
  </rdf:Alt></dc:description>
 </rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end='w'?>
"""


@unittest.skipUnless(shutil.which("exiftool"), "exiftool binary not available")
class LangAltWithoutDefaultTest(TestCase):
    """A dc:description with language entries only, through real ExifTool."""

    def setUp(self):
        self.user = create_test_user()
        directory = tempfile.mkdtemp(prefix="librephotos-langalt")
        self.addCleanup(shutil.rmtree, directory, True)
        image = os.path.join(directory, "photo.jpg")
        shutil.copy2(NIAZ_IMAGE, image)
        sidecar = os.path.join(directory, "photo.xmp")
        with open(sidecar, "w", encoding="utf-8") as f:
            f.write(LANG_ALT_ONLY_SIDECAR)
        self.photo = create_test_photo(owner=self.user)
        self.photo.main_file = File.create(image, self.user)
        self.photo.save()

    def test_x_default_tag_alone_finds_nothing(self):
        """Why the fallback exists: XMP:Description is empty here."""
        with exiftool.ExifTool() as et:
            self.assertIsNone(et.get_tag("XMP:Description", self.photo.main_file.path))

    def test_first_language_entry_is_imported(self):
        with patch(
            "api.models.photo_metadata.get_metadata",
            side_effect=_exiftool_get_metadata,
        ):
            metadata = PhotoMetadata.extract_exif_data(self.photo, commit=True)

        self.assertEqual(metadata.caption, "Ein Hund am Strand")
