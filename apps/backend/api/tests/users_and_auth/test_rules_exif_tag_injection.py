"""Saving ``burst_detection_rules`` / ``datetime_rules`` through
PATCH /api/user/<id>/ rejects ExifTool tag names that would let the rule turn
a metadata read into a write, rename or ExifTool option injection.

The tag names in these rules are handed to ExifTool by the exif sidecar, and
any authenticated user can PATCH them onto their own profile, so the check is
here at save time (a matching defense in depth lives in the sidecar itself,
tested in api.tests.metadata.test_exif_service_tag_validation).
"""

import json

from django.test import TestCase
from rest_framework.test import APIClient

from api.burst_detection_rules import get_default_burst_detection_rules
from api.date_time_extractor import DEFAULT_RULES_JSON
from api.models import User
from api.tests.utils import create_test_user


class RulesExifTagInjectionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def patch(self, field, value):
        return self.client.patch(
            f"/api/user/{self.user.id}/", {field: value}, format="json"
        )

    # -- rejects injection ------------------------------------------------

    def test_rejects_write_tag_in_burst_condition_exif(self):
        response = self.patch(
            "burst_detection_rules",
            [{"rule_type": "exif_burst_mode", "condition_exif": "EXIF:Model=1//x"}],
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "burst_detection_rules")

    def test_rejects_newline_tag_in_datetime_condition_exif(self):
        # The settings page sends datetime_rules as a JSON-encoded string.
        response = self.patch(
            "datetime_rules",
            json.dumps(
                [{"rule_type": "exif", "condition_exif": "EXIF:Model\n-if\n1//x"}]
            ),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "datetime_rules")

    def test_rejects_write_tag_in_datetime_exif_tag(self):
        response = self.patch(
            "datetime_rules",
            json.dumps([{"rule_type": "exif", "exif_tag": "FileName=../evil.jpg"}]),
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_newline_tag_in_datetime_exif_tag(self):
        response = self.patch(
            "datetime_rules",
            json.dumps(
                [{"rule_type": "exif", "exif_tag": "EXIF:DateTimeOriginal\n-o\nout"}]
            ),
        )
        self.assertEqual(response.status_code, 400)

    def test_a_rejected_save_does_not_change_the_stored_rules(self):
        before = User.objects.get(id=self.user.id).burst_detection_rules
        self.patch(
            "burst_detection_rules",
            [{"rule_type": "exif_burst_mode", "condition_exif": "all=//x"}],
        )
        after = User.objects.get(id=self.user.id).burst_detection_rules
        self.assertEqual(after, before)

    # -- accepts the shipped defaults and ordinary tags -------------------

    def test_default_burst_rules_validate(self):
        response = self.patch(
            "burst_detection_rules", get_default_burst_detection_rules()
        )
        self.assertEqual(response.status_code, 200)

    def test_default_datetime_rules_validate(self):
        # DEFAULT_RULES_JSON is the JSON string the field ships with.
        response = self.patch("datetime_rules", DEFAULT_RULES_JSON)
        self.assertEqual(response.status_code, 200)

    def test_a_valid_custom_condition_exif_is_accepted(self):
        rules_json = json.dumps(
            [
                {
                    "rule_type": "filesystem",
                    "file_property": "mtime",
                    "condition_exif": "EXIF:Model//FooBar",
                }
            ]
        )
        response = self.patch("datetime_rules", rules_json)
        self.assertEqual(response.status_code, 200)
        saved = json.loads(User.objects.get(id=self.user.id).datetime_rules)
        self.assertEqual(saved[0]["condition_exif"], "EXIF:Model//FooBar")
