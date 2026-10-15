import importlib
import json

from django.apps import apps as global_apps
from django.test import TestCase

from api.metadata.datetime_rules import DEFAULT_RULES_PARAMS, OTHER_RULES_PARAMS
from api.models import User

from ..utils import create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0183 = importlib.import_module("api.migrations.0183_takeout_date_rules")

# The default list before #2270 added the Takeout rules 20 and 21.
OLD_DEFAULT_IDS = [16, 1, 15, 17, 2, 18, 11, 3, 4, 19, 5]
# The default list of an account made before rules 15 and 16 existed, after
# 0167 and 0168.
OLDER_DEFAULT_IDS = [1, 17, 2, 18, 11, 3, 4, 19, 5]


def default_rules(ids):
    by_id = {rule["id"]: rule for rule in DEFAULT_RULES_PARAMS + OTHER_RULES_PARAMS}
    return [dict(by_id[rule_id]) for rule_id in ids]


def ids_of(stored):
    rules = json.loads(stored) if isinstance(stored, str) else stored
    return [rule["id"] for rule in rules]


class TakeoutDateRulesMigrationTest(TestCase):
    """Rules 20 and 21 reach the rule lists nobody changed."""

    def _user_with(self, datetime_rules):
        user = create_test_user()
        user.datetime_rules = datetime_rules
        user.save(update_fields=["datetime_rules"])
        return user

    def _rules_after(self, user, step=migration_0183.add_takeout_rules):
        step(global_apps, None)
        return User.objects.get(pk=user.pk).datetime_rules

    def test_the_default_list_gets_the_takeout_rules_before_the_file_name(self):
        user = self._user_with(json.dumps(default_rules(OLD_DEFAULT_IDS)))

        stored = self._rules_after(user)

        self.assertIsInstance(stored, str)
        self.assertEqual([rule["id"] for rule in DEFAULT_RULES_PARAMS], ids_of(stored))

    def test_the_added_rules_are_the_ones_a_new_account_gets(self):
        user = self._user_with(json.dumps(default_rules(OLD_DEFAULT_IDS)))

        added = [
            rule
            for rule in json.loads(self._rules_after(user))
            if rule["id"] in migration_0183.NEW_IDS
        ]

        defaults = {rule["id"]: rule for rule in DEFAULT_RULES_PARAMS}
        self.assertEqual([defaults[20], defaults[21]], added)

    def test_an_older_default_list_gets_them_too(self):
        user = self._user_with(json.dumps(default_rules(OLDER_DEFAULT_IDS)))

        stored = self._rules_after(user)

        self.assertEqual([1, 17, 2, 18, 11, 20, 21, 3, 4, 19, 5], ids_of(stored))

    def test_a_list_saved_as_a_list_stays_a_list(self):
        user = self._user_with(default_rules(OLD_DEFAULT_IDS))

        stored = self._rules_after(user)

        self.assertIsInstance(stored, list)
        self.assertEqual([rule["id"] for rule in DEFAULT_RULES_PARAMS], ids_of(stored))

    def test_customised_lists_are_unchanged(self):
        customised = {
            "reordered": OLD_DEFAULT_IDS[::-1],
            "another rule added": [*OLD_DEFAULT_IDS, 7],
            "without the file name rule": [i for i in OLD_DEFAULT_IDS if i != 3],
            "a rule twice": [*OLD_DEFAULT_IDS, 5],
        }
        for case, ids in customised.items():
            with self.subTest(case):
                stored = json.dumps(default_rules(ids))
                user = self._user_with(stored)

                self.assertEqual(stored, self._rules_after(user))

    def test_a_list_that_has_a_takeout_rule_already_is_unchanged(self):
        rules = default_rules(OLD_DEFAULT_IDS) + [dict(migration_0183.RULE_21)]
        user = self._user_with(json.dumps(rules))

        self.assertEqual(json.dumps(rules), self._rules_after(user))

    def test_an_unreadable_list_is_unchanged(self):
        for stored in ("not json", json.dumps({"id": 3}), json.dumps([3, 1])):
            with self.subTest(stored=stored):
                user = self._user_with(stored)

                self.assertEqual(stored, self._rules_after(user))

    def test_reversing_removes_the_takeout_rules(self):
        user = self._user_with(json.dumps(default_rules(OLD_DEFAULT_IDS)))
        self._rules_after(user)

        stored = self._rules_after(user, migration_0183.remove_takeout_rules)

        self.assertEqual(OLD_DEFAULT_IDS, ids_of(stored))

    def test_reversing_leaves_a_list_without_them_alone(self):
        stored = json.dumps(default_rules(OLD_DEFAULT_IDS))
        user = self._user_with(stored)

        self.assertEqual(
            stored, self._rules_after(user, migration_0183.remove_takeout_rules)
        )
