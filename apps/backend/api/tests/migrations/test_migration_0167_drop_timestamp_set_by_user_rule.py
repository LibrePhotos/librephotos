import importlib
import json

from django.apps import apps as global_apps
from django.db import connection
from django.test import TestCase

from api.models import User
from api.tests.utils import create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0167 = importlib.import_module(
    "api.migrations.0167_drop_timestamp_set_by_user_rule"
)

RULE_14 = {
    "id": 14,
    "name": "Timestamp set by user",
    "rule_type": "user_defined",
    "is_default": True,
}
RULE_16 = {"id": 16, "name": "XMP", "rule_type": "exif", "exif_tag": "XMP:DateCreated"}
RULE_1 = {"id": 1, "name": "EXIF", "rule_type": "exif", "exif_tag": "EXIF:DateTimeOriginal"}
RULE_7 = {"id": 7, "name": "mtime", "rule_type": "filesystem", "file_property": "mtime"}


class DropTimestampSetByUserRuleTest(TestCase):
    """#2254: saved rule lists lose rule 14 and keep the order of the others."""

    def _user(self, rules):
        user = create_test_user()
        User.objects.filter(pk=user.pk).update(datetime_rules=rules)
        return user

    def _rules(self, user):
        return User.objects.get(pk=user.pk).datetime_rules

    def _forwards(self):
        # The editor is not used: no context, no DDL.
        migration_0167.forwards(global_apps, connection.schema_editor())

    def _backwards(self):
        migration_0167.backwards(global_apps, connection.schema_editor())

    def test_a_json_string_list_loses_the_rule_and_keeps_the_order(self):
        user = self._user(json.dumps([RULE_14, RULE_16, RULE_7, RULE_1]))

        self._forwards()

        self.assertEqual(json.loads(self._rules(user)), [RULE_16, RULE_7, RULE_1])

    def test_a_list_stays_a_list(self):
        user = self._user([RULE_16, RULE_1, RULE_14])

        self._forwards()

        self.assertEqual(self._rules(user), [RULE_16, RULE_1])

    def test_a_bare_id_entry_goes_too(self):
        user = self._user(json.dumps([{"id": 14}, RULE_1]))

        self._forwards()

        self.assertEqual(json.loads(self._rules(user)), [RULE_1])

    def test_a_list_without_the_rule_is_untouched(self):
        stored = json.dumps([RULE_1, RULE_16])
        user = self._user(stored)

        self._forwards()

        self.assertEqual(self._rules(user), stored)

    def test_unreadable_values_are_left_alone(self):
        for stored in ("not json", json.dumps({"id": 14}), ["junk", 3]):
            with self.subTest(stored=stored):
                user = self._user(stored)

                self._forwards()

                self.assertEqual(self._rules(user), stored)

    def test_going_back_puts_the_rule_first(self):
        user = self._user(json.dumps([RULE_16, RULE_1]))

        self._backwards()

        self.assertEqual(json.loads(self._rules(user)), [RULE_14, RULE_16, RULE_1])
