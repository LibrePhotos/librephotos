import os

from django.test import TestCase
from django.utils import timezone
from faker import Faker
from rest_framework.test import APIClient

from api.models import File, Person, Photo
from api.tests.utils import create_test_user


class ReadFacesFromPhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user1)

    def test_reading_from_photo(self):
        file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.jpg"

        exif_file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.xmp"

        fake = Faker()
        pk = fake.md5()
        os.system("cp " + file + " " + "/tmp/" + str(pk) + ".jpg")
        # copy exif file to photo and rename it to have the same name as the photo but with .xmp extension
        os.system("cp " + exif_file + " " + "/tmp/" + str(pk) + ".xmp")
        # we need a thumbnail in the thumbnails_big folder
        os.system(
            "cp " + file + " " + "/protected_media/thumbnails_big/" + str(pk) + ".jpg"
        )

        photo = Photo(pk=pk, image_hash=pk, aspect_ratio=1, owner=self.user1)
        fileObject = File.create("/tmp/" + str(photo.pk) + ".jpg", self.user1)
        photo.main_file = fileObject
        photo.added_on = timezone.now()
        photo.thumbnail_big = (
            "/protected_media/thumbnails_big/" + str(photo.pk) + ".jpg"
        )
        photo.save()

        photo._extract_faces()

        # To Debug Face Extraction: Look at the actual produced thumbnail
        # Thumbnail is wrong at the moment, need to create a correct face tag first, where I know the face is correct
        # output_file = (
        #        os.path.dirname(os.path.abspath(__file__))
        #        + "/fixtures/niaz_face.jpg"
        # )
        # os.system("cp " + "/protected_media/faces/" + str(photo.pk) + "_0.jpg" + " " + output_file)

        self.assertEqual(1, len(photo.faces.all()))
        # One Niaz Faridani-Rad
        self.assertEqual(1, len(Person.objects.all()))
        # There has to be a face encoding
        self.assertIsNotNone(photo.faces.all()[0].encoding)
        self.assertEqual(
            "Niaz Faridani-Rad",
            Person.objects.filter(name="Niaz Faridani-Rad").first().name,
        )
