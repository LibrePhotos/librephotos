import importlib
import json

from django.apps import apps as global_apps
from django.test import TestCase

from api.metadata.datetime_rules import DEFAULT_RULES_PARAMS
from api.models import User

from ..utils import create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0168 = importlib.import_module("api.migrations.0168_video_date_rules")

# The default list before #2268 added rules 17-19 (after 0167 dropped rule 14).
OLD_DEFAULT_IDS = [16, 1, 15, 2, 11, 3, 4, 5]
# The default list 0168 left: 0183 added the Takeout rules 20 and 21 later (#2270).
DEFAULT_IDS_AFTER = [16, 1, 15, 17, 2, 18, 11, 3, 4, 19, 5]


def old_default_rules():
    by_id = {rule["id"]: rule for rule in DEFAULT_RULES_PARAMS}
    return [dict(by_id[rule_id]) for rule_id in OLD_DEFAULT_IDS]


def ids_of(stored):
    rules = json.loads(stored) if isinstance(stored, str) else stored
    return [rule["id"] for rule in rules]


class VideoDateRulesMigrationTest(TestCase):
    """Rules 17-19 reach the date rules existing accounts already have."""

    def _user_with(self, datetime_rules):
        user = create_test_user()
        user.datetime_rules = datetime_rules
        user.save(update_fields=["datetime_rules"])
        return user

    def _rules_after(self, user, step=migration_0168.add_video_date_rules):
        step(global_apps, None)
        return User.objects.get(pk=user.pk).datetime_rules

    def test_the_old_default_list_gets_the_new_defaults_in_order(self):
        user = self._user_with(json.dumps(old_default_rules()))

        stored = self._rules_after(user)

        self.assertIsInstance(stored, str)
        self.assertEqual(DEFAULT_IDS_AFTER, ids_of(stored))

    def test_the_added_rules_are_the_ones_a_new_account_gets(self):
        user = self._user_with(json.dumps(old_default_rules()))

        added = {
            rule["id"]: rule
            for rule in json.loads(self._rules_after(user))
            if rule["id"] in migration_0168.NEW_IDS
        }

        defaults = {rule["id"]: rule for rule in DEFAULT_RULES_PARAMS}
        for rule_id, rule in added.items():
            self.assertEqual(defaults[rule_id], rule)

    def test_a_list_saved_as_a_list_stays_a_list(self):
        user = self._user_with(old_default_rules())

        stored = self._rules_after(user)

        self.assertIsInstance(stored, list)
        self.assertEqual(DEFAULT_IDS_AFTER, ids_of(stored))

    def test_a_reordered_list_gets_the_rules_next_to_rules_2_and_4(self):
        user = self._user_with(json.dumps(old_default_rules()[::-1]))

        stored = self._rules_after(user)

        self.assertEqual([5, 4, 19, 3, 11, 17, 2, 18, 15, 1, 16], ids_of(stored))

    def test_a_list_without_rule_2_is_unchanged(self):
        rules = [rule for rule in old_default_rules() if rule["id"] != 2]
        user = self._user_with(json.dumps(rules))

        self.assertEqual(json.dumps(rules), self._rules_after(user))

    def test_a_list_that_has_a_new_rule_already_is_unchanged(self):
        rules = old_default_rules() + [
            dict(migration_0168.RULE_18, name="My MKV rule")
        ]
        user = self._user_with(json.dumps(rules))

        self.assertEqual(json.dumps(rules), self._rules_after(user))

    def test_an_unreadable_list_is_unchanged(self):
        user = self._user_with("not json")

        self.assertEqual("not json", self._rules_after(user))

    def test_reversing_removes_the_new_rules(self):
        user = self._user_with(json.dumps(old_default_rules()))
        self._rules_after(user)

        stored = self._rules_after(user, migration_0168.remove_video_date_rules)

        self.assertEqual(OLD_DEFAULT_IDS, ids_of(stored))
