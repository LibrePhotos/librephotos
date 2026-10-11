import os
import shutil

from django.test import override_settings

from api.models import Person
from api.photo_faces import extract_faces
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
)


@override_settings(FEATURE_FACE_DETECTION=True)
class ReadFacesFromPhotosTest(RealExifToolTestCase):
    """A face region in an XMP sidecar becomes a named face on import.

    Runs against real ExifTool through the exif service's own code
    (``RealExifToolTestCase``), so it no longer needs a running exif service
    and is not skipped in CI.
    """

    def test_reading_from_photo(self):
        user = create_test_user(favorite_min_rating=1)
        photo_path = os.path.join(self.directory, "niaz.jpg")
        shutil.copyfile(os.path.join(FIXTURES, "niaz.jpg"), photo_path)
        # The sidecar has to sit next to the photo under the same basename.
        shutil.copyfile(
            os.path.join(FIXTURES, "niaz.xmp"), os.path.join(self.directory, "niaz.xmp")
        )
        photo = self.photo_for(photo_path, user, thumbnails=True)

        extract_faces(photo)

        faces = list(photo.faces.all())
        self.assertEqual(1, len(faces))
        self.assertEqual(
            ["Niaz Faridani-Rad"], list(Person.objects.values_list("name", flat=True))
        )
        self.assertEqual("Niaz Faridani-Rad", faces[0].person.name)
        # An XMP region has no encoding until generate_face_embeddings runs.
        self.assertIsNotNone(faces[0].encoding)
