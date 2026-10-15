import json

from django.test import TestCase
from rest_framework.test import APIClient

from api.metadata.datetime_rules import DEFAULT_RULES_PARAMS, OTHER_RULES_PARAMS
from api.tests.utils import create_test_user


class PredefinedRulesTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(
            is_admin=True, username="test_admin", email="test_admin@test.com"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_predefined_rules(self):
        response = self.client.get("/api/predefinedrules/")
        self.assertEqual(200, response.status_code)
        data = response.json()
        self.assertIsInstance(data, str)
        rules = json.loads(data)
        self.assertIsInstance(rules, list)
        # 16 until "Timestamp set by user" (id 14) left the list (#2254),
        # then the video rules 17-19 joined it (#2268), then the Google
        # Takeout rules 20 and 21 (#2270).
        self.assertEqual(20, len(rules))

    def test_default_rules_on_predefined_rules_endpoint(self):
        response = self.client.get("/api/predefinedrules/")
        rules = json.loads(response.json())
        default_rules = list(filter(lambda x: x["is_default"], rules))
        self.assertListEqual(DEFAULT_RULES_PARAMS, default_rules)

    def test_default_rules_endpoint(self):
        response = self.client.get("/api/defaultrules/")
        rules = json.loads(response.json())
        self.assertListEqual(DEFAULT_RULES_PARAMS, rules)

    def test_other_rules(self):
        response = self.client.get("/api/predefinedrules/")
        rules = json.loads(response.json())
        other_rules = list(filter(lambda x: not x["is_default"], rules))
        self.assertListEqual(OTHER_RULES_PARAMS, other_rules)

    def test_rule_ids_are_unique(self):
        """Rule ids identify a rule in the settings UI, so they must not collide."""
        ids = [rule["id"] for rule in DEFAULT_RULES_PARAMS + OTHER_RULES_PARAMS]
        self.assertEqual(len(ids), len(set(ids)), f"duplicate rule ids in {ids}")
