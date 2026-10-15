"""Add the Google Takeout date rules 20 and 21 to unmodified rule lists (#2270).

A user's date rules are a copy of the defaults taken when the account was
made, so new default rules never reach existing accounts by themselves. The
two new ones read the capture time of the Takeout JSON next to a file and go
right before rule 3 (the file name): every tag of the file still wins, and the
JSON beats the name an export gave the file.

Only a list nobody changed gets them: one made of default rules alone, in the
default order, with rule 3 and neither new rule. The default list of an older
version is such a list too (it is part of today's). A list with another rule,
a rule moved, or a rule missing from today's defaults is left alone; its owner
can add the rules on the settings page. The list keeps the form it was stored
in (the settings page saves a JSON string, the API also takes the list).
Reversing removes rules 20 and 21 again.
"""

import json

from django.db import migrations

# The rules as they were defined when this migration was written.
RULE_20 = {
    "id": 20,
    "name": "Google Takeout JSON capture time in UTC + figure out timezone using GPS coordinates",
    "rule_type": "takeout_json",
    "transform_tz": 1,
    "source_tz": "utc",
    "report_tz": "gps_timezonefinder",
    "is_default": True,
}
RULE_21 = {
    "id": 21,
    "name": "Google Takeout JSON capture time in user default timezone (can't find out actual timezone)",
    "rule_type": "takeout_json",
    "transform_tz": 1,
    "source_tz": "utc",
    "report_tz": "user_default",
    "is_default": True,
}
NEW_IDS = {20, 21}
FILENAME_RULE_ID = 3
# The default rule ids in their order before this migration (0168's list).
DEFAULT_ORDER = [16, 1, 15, 17, 2, 18, 11, 3, 4, 19, 5]


def _rules_of(stored):
    """The stored rule list, parsed, or None when it is not a list of rules."""
    rules = stored
    if isinstance(rules, str):
        try:
            rules = json.loads(rules)
        except ValueError:
            return None
    if not isinstance(rules, list) or not all(isinstance(r, dict) for r in rules):
        return None
    return rules


def _stored_like(stored, rules):
    return json.dumps(rules) if isinstance(stored, str) else rules


def is_unmodified(ids):
    """Whether ``ids`` are default rules only, each once, in the default order,
    with the file name rule: a default list of this or an earlier version."""
    if not all(rule_id in DEFAULT_ORDER for rule_id in ids):
        return False
    if FILENAME_RULE_ID not in ids or len(set(ids)) != len(ids):
        return False
    return ids == sorted(ids, key=DEFAULT_ORDER.index)


def with_takeout_rules(stored):
    """``stored`` with rules 20 and 21 before rule 3, or None when it is left
    as it is."""
    rules = _rules_of(stored)
    if rules is None or not is_unmodified([rule.get("id") for rule in rules]):
        return None
    updated = []
    for rule in rules:
        if rule.get("id") == FILENAME_RULE_ID:
            updated += [dict(RULE_20), dict(RULE_21)]
        updated.append(rule)
    return _stored_like(stored, updated)


def without_takeout_rules(stored):
    """``stored`` without rules 20 and 21, or None when it has neither."""
    rules = _rules_of(stored)
    if rules is None or not {rule.get("id") for rule in rules} & NEW_IDS:
        return None
    return _stored_like(
        stored, [rule for rule in rules if rule.get("id") not in NEW_IDS]
    )


def _rewrite_rules(apps, change):
    User = apps.get_model("api", "User")
    for user in User.objects.only("id", "datetime_rules").iterator():
        updated = change(user.datetime_rules)
        if updated is not None:
            user.datetime_rules = updated
            user.save(update_fields=["datetime_rules"])


def add_takeout_rules(apps, schema_editor):
    _rewrite_rules(apps, with_takeout_rules)


def remove_takeout_rules(apps, schema_editor):
    _rewrite_rules(apps, without_takeout_rules)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0182_file_indexed_mtimes"),
    ]

    operations = [
        migrations.RunPython(add_takeout_rules, remove_takeout_rules),
    ]
