"""The settings page saves the burst detection rules with the rest of the
profile, through PATCH /api/user/<id>/.

``burst_detection_rules`` was a serializer field but missing from the fields
``UserSerializer.update`` copies onto the user, so the PATCH answered 200 and
dropped it: reordering, disabling or removing a rule was lost on reload.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.burst_detection_rules import get_default_burst_detection_rules
from api.models import User
from api.tests.utils import create_test_user


class BurstRulesSettingsSaveTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_patch_saves_reordered_and_toggled_rules(self):
        rules = list(reversed(get_default_burst_detection_rules()))
        rules[0] = {**rules[0], "enabled": not rules[0]["enabled"]}

        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"burst_detection_rules": rules},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        saved = User.objects.get(id=self.user.id).burst_detection_rules
        self.assertEqual([rule["id"] for rule in saved], [rule["id"] for rule in rules])
        self.assertEqual(saved[0]["enabled"], rules[0]["enabled"])
        self.assertEqual(response.json()["burst_detection_rules"], saved)
