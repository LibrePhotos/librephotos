from datetime import datetime, timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photos, create_test_user


class DeleteMonthOldPhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_delete_month_old_photos(self):
        twoMonthOldDate = datetime.now() - timedelta(days=60)
        tenDaysAgoDate = datetime.now() - timedelta(days=10)
        photos_to_delete = create_test_photos(
            number_of_photos=2,
            owner=self.user1,
            deleted=True,
            moved_to_trash_on=twoMonthOldDate,
        )
        photos_not_to_delete = create_test_photos(
            number_of_photos=2,
            owner=self.user1,
            deleted=True,
            moved_to_trash_on=tenDaysAgoDate,
        )
        image_hashes_not_deleted = [p.image_hash for p in photos_not_to_delete]
        images_to_be_deleted = [p.image_hash for p in photos_to_delete]
        payload = {"image_hashes": image_hashes_not_deleted + images_to_be_deleted}
        headers = {"Content-Type": "application/json"}
        response = self.client.delete(
            "/api/deletephotosaftermonth/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()
        self.assertEqual(2, len(data["deleted"]))
        self.assertEqual(2, len(data["not_deleted"]))
