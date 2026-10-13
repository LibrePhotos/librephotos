"""Drop the "Timestamp set by user" date rule (id 14) from saved rule lists.

A date set by hand used to apply only through that rule, an ordinary entry of
``User.datetime_rules``: deleted, or moved below an EXIF rule, a date edit
changed nothing and a rescan dropped the dates set earlier (#2254). A date set
by hand now overrides every rule (``api.metadata.photo_datetime``), so the
entry matches nothing and only confused the list. Every other entry keeps its
place.

``datetime_rules`` holds the JSON string the settings page sends, or the list
itself when a client PATCHed one; each is written back in the form it had. A
value that is not a JSON list is left alone (the scan cannot read it either).

Going back puts the rule first again, where the old default list had it, so
the older code keeps applying hand-set dates.
"""

import json
from collections.abc import Callable

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

RULE_ID = 14
RULE_TYPE = "user_defined"
OLD_RULE = {"id": RULE_ID, "name": "Timestamp set by user", "rule_type": RULE_TYPE}


def is_timestamp_set_by_user(entry: object) -> bool:
    return isinstance(entry, dict) and (
        entry.get("id") == RULE_ID or entry.get("rule_type") == RULE_TYPE
    )


def without_rule(rules: list[object]) -> list[object]:
    return [entry for entry in rules if not is_timestamp_set_by_user(entry)]


def with_rule_first(rules: list[object]) -> list[object]:
    if any(is_timestamp_set_by_user(entry) for entry in rules):
        return rules
    return [dict(OLD_RULE, is_default=True), *rules]


def rewrite(stored: object, change: Callable[[list[object]], list[object]]) -> object:
    """``stored`` with ``change`` applied to its list, in the form it was stored."""
    if isinstance(stored, list):
        return change(stored)
    if isinstance(stored, str):
        try:
            rules = json.loads(stored)
        except ValueError:
            return stored
        if isinstance(rules, list):
            return json.dumps(change(rules))
    return stored


def _rewrite_all(apps: Apps, change: Callable[[list[object]], list[object]]) -> None:
    user_model = apps.get_model("api", "User")
    for user in user_model.objects.only("id", "datetime_rules").iterator():
        new = rewrite(user.datetime_rules, change)
        if new != user.datetime_rules:
            user_model.objects.filter(pk=user.pk).update(datetime_rules=new)


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite_all(apps, without_rule)


def backwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite_all(apps, with_rule_first)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0166_photo_location_source"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
