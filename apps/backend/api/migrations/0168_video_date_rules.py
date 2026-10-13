"""Add the video date rules 17-19 to the date rules users already have (#2268).

A user's date rules are a copy of the defaults taken when the account was
made, so new default rules never reach existing accounts by themselves. The
three new ones date videos that no rule could date before:

* 17, the local time a phone writes into ``QuickTime:CreationDate``, goes
  right before rule 2 (the UTC ``QuickTime:CreateDate`` converted with GPS);
* 18, the MKV/WebM ``Matroska:DateTimeOriginal`` converted with GPS, right
  after rule 2;
* 19, the same date in the user's default time zone, right after rule 4 (the
  UTC ``QuickTime:CreateDate`` in that zone).

Only a list that holds both rule 2 and rule 4, and none of 17-19 yet, is
changed; any other list was customised and is left alone. The list keeps the
form it was stored in (the settings page saves a JSON string, the API also
takes the list). Reversing removes rules 17-19 again.
"""

import json

from django.db import migrations

# The rules as they were defined when this migration was written.
RULE_17 = {
    "id": 17,
    "name": "Local time from the video's QuickTime:CreationDate tag (phones)",
    "rule_type": "exif",
    "exif_tag": "QuickTime:CreationDate",
    "is_default": True,
}
RULE_18 = {
    "id": 18,
    "name": "Get MKV/WebM creation date in UTC + figure out timezone using GPS coordinates",
    "rule_type": "exif",
    "exif_tag": "Matroska:DateTimeOriginal",
    "transform_tz": 1,
    "source_tz": "utc",
    "report_tz": "gps_timezonefinder",
    "is_default": True,
}
RULE_19 = {
    "id": 19,
    "name": "MKV/WebM creation date in user default timezone (can't find out actual timezone)",
    "rule_type": "exif",
    "exif_tag": "Matroska:DateTimeOriginal",
    "transform_tz": 1,
    "source_tz": "utc",
    "report_tz": "user_default",
    "is_default": True,
}
NEW_IDS = {17, 18, 19}


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


def with_video_date_rules(stored):
    """``stored`` with rules 17-19 added, or None when it is left as it is."""
    rules = _rules_of(stored)
    if rules is None:
        return None
    ids = {rule.get("id") for rule in rules}
    if not {2, 4} <= ids or ids & NEW_IDS:
        return None
    updated = []
    for rule in rules:
        if rule.get("id") == 2:
            updated += [dict(RULE_17), rule, dict(RULE_18)]
        elif rule.get("id") == 4:
            updated += [rule, dict(RULE_19)]
        else:
            updated.append(rule)
    return _stored_like(stored, updated)


def without_video_date_rules(stored):
    """``stored`` without rules 17-19, or None when it has none of them."""
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


def add_video_date_rules(apps, schema_editor):
    _rewrite_rules(apps, with_video_date_rules)


def remove_video_date_rules(apps, schema_editor):
    _rewrite_rules(apps, without_video_date_rules)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0167_drop_timestamp_set_by_user_rule"),
    ]

    operations = [
        migrations.RunPython(add_video_date_rules, remove_video_date_rules),
    ]
