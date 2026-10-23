"""Which date rules a user may save (#2272).

The settings page lets people write their own date rules, and every rule a
user saves runs in the scan worker, which all users share. So a new or changed
rule is checked before it is stored (``changed_rule_problem``, from
``UserSerializer.validate_datetime_rules``), and the rule form asks the same
question for one rule first (``rule_problems``, ``POST
/api/datetime-rules/check/``):

* its tags are on the lists below, each of which ExifTool knows under that
  name (``api/tests/metadata/test_exiftool_tag_names.py`` asks the real
  binary). A well-formed name ExifTool does not know reads nothing, so a
  rule on ``EXIF:DateTime`` never matched and nobody was told (#1858);
* its file-name date is a pattern (``api.metadata.date_patterns``), never a
  regular expression, and its conditions are plain text: the expressions
  built from them cannot backtrack, so no rule can stall a scan;
* its time zones are ones ``TimeExtractionRule._get_tz`` reads.

A rule already saved is not checked again: a list saved through the API
before these checks keeps working and can still be reordered or added to.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass

import pytz

from api.metadata.date_patterns import DatePatternError, compile_date_pattern
from api.metadata.datetime_rules import PREDEFINED_REGEXPS, RuleTypes
from api.metadata.tags import Tags


@dataclass(frozen=True)
class DateTag:
    """A tag a date rule may read; ``utc`` when its value is usually in UTC,
    so a rule on it converts the time to a local one."""

    name: str
    utc: bool


DATE_TAGS: tuple[DateTag, ...] = (
    DateTag(Tags.DATE_TIME_ORIGINAL, False),
    DateTag("EXIF:CreateDate", False),
    DateTag(Tags.DATE_TIME, False),
    DateTag("Composite:SubSecDateTimeOriginal", False),
    DateTag("Composite:SubSecCreateDate", False),
    DateTag("Composite:SubSecModifyDate", False),
    DateTag("Composite:DateTimeCreated", False),
    DateTag(Tags.GPS_DATE_TIME, True),
    DateTag(Tags.DATE_CREATED, False),
    DateTag("XMP:DateTimeOriginal", False),
    DateTag("XMP-exif:DateTimeOriginal", False),
    DateTag("XMP:CreateDate", False),
    DateTag("XMP:ModifyDate", False),
    DateTag(Tags.QUICKTIME_CREATION_DATE, False),
    DateTag("QuickTime:ContentCreateDate", False),
    DateTag(Tags.QUICKTIME_CREATE_DATE, True),
    DateTag("QuickTime:ModifyDate", True),
    DateTag("QuickTime:MediaCreateDate", True),
    DateTag("QuickTime:MediaModifyDate", True),
    DateTag("QuickTime:TrackCreateDate", True),
    DateTag(Tags.MATROSKA_DATE, True),
    DateTag("RIFF:DateTimeOriginal", False),
    DateTag("PNG:CreationTime", False),
)
DATE_TAG_NAMES = frozenset(tag.name for tag in DATE_TAGS)

# What "Only when the tag ... contains" may look at: the camera and the file
# type, and every date tag.
CONDITION_TAGS: tuple[str, ...] = (
    Tags.MAKE,
    Tags.CAMERA,
    "EXIF:Software",
    Tags.LENS,
    Tags.QUICKTIME_MAKE,
    Tags.QUICKTIME_MODEL,
    "QuickTime:Software",
    "File:FileType",
    "File:MIMEType",
    *(tag.name for tag in DATE_TAGS),
)

TIME_ZONE_KEYWORDS = ("utc", "gps_timezonefinder", "user_default", "server_local")
ZONE_PREFIX = "name:"
RULE_TYPES = (
    RuleTypes.EXIF,
    RuleTypes.PATH,
    RuleTypes.FILESYSTEM,
    RuleTypes.TAKEOUT_JSON,
    RuleTypes.USER_DEFINED,
)
FILE_PROPERTIES = ("mtime", "ctime")
PATH_PARTS = ("filename", "full_path")
MAX_TEXT_LENGTH = 200
# Custom rules get ids from here up, so they never take a predefined id.
FIRST_CUSTOM_ID = 1000
_MAX_ID = 2**31 - 1
_CONDITION_SEPARATOR = "//"
# The characters that make an expression more than plain text.
_SPECIAL = frozenset(".^$*+?{}[]|()")

# Rule param -> why its value cannot be saved.
Problems = dict[str, str]
Rule = dict[str, object]


def is_plain_text_pattern(value: str) -> bool:
    """Whether ``value`` is plain text written as an expression: each special
    character escaped (``re.escape``), and no ``\\d``-style class or
    back-reference, which only an ASCII letter or digit after ``\\`` makes."""
    escaped = False
    for char in value:
        if escaped:
            if char.isascii() and char.isalnum():
                return False
            escaped = False
        elif char == "\\":
            escaped = True
        elif char in _SPECIAL:
            return False
    return not escaped


def _text_problem(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > MAX_TEXT_LENGTH:
        return f"Must be text of at most {MAX_TEXT_LENGTH} characters."
    if not is_plain_text_pattern(value):
        return "Must be plain text: write ., *, ? and the like with a \\ in front."
    return None


def _time_zone_problem(value: object) -> str | None:
    if isinstance(value, str) and value.lower() in TIME_ZONE_KEYWORDS:
        return None
    if isinstance(value, str) and value.startswith(ZONE_PREFIX):
        if value[len(ZONE_PREFIX) :] in pytz.all_timezones_set:
            return None
        return f"Unknown time zone {value[len(ZONE_PREFIX) :]!r}."
    return "Must be utc, gps_timezonefinder, user_default, server_local or name:<zone>."


def _exif_problems(rule: Rule) -> Problems:
    if rule.get("exif_tag") in DATE_TAG_NAMES:
        return {}
    return {"exif_tag": "Pick one of the date tags LibrePhotos can read."}


def _path_problems(rule: Rule) -> Problems:
    problems: Problems = {}
    if (rule.get("path_part") or "filename") not in PATH_PARTS:
        problems["path_part"] = "Must be filename or full_path."
    if "custom_regexp" in rule:
        problems["custom_regexp"] = "Write where the date is as a date_pattern."
    predefined = rule.get("predefined_regexp", "default")
    if not isinstance(predefined, str) or predefined not in PREDEFINED_REGEXPS:
        problems["predefined_regexp"] = "Unknown file name pattern."
    if "date_pattern" in rule:
        try:
            compile_date_pattern(str(rule["date_pattern"]))
        except DatePatternError as error:
            problems["date_pattern"] = str(error)
    return problems


def _filesystem_problems(rule: Rule) -> Problems:
    if rule.get("file_property") in FILE_PROPERTIES:
        return {}
    return {"file_property": "Must be mtime or ctime."}


def _no_problems(rule: Rule) -> Problems:
    return {}


_TYPE_CHECKS: dict[object, Callable[[Rule], Problems]] = {
    RuleTypes.EXIF: _exif_problems,
    RuleTypes.PATH: _path_problems,
    RuleTypes.FILESYSTEM: _filesystem_problems,
    RuleTypes.TAKEOUT_JSON: _no_problems,
    RuleTypes.USER_DEFINED: _no_problems,
}


def _type_problems(rule: Rule) -> Problems:
    check = _TYPE_CHECKS.get(rule.get("rule_type"))
    if check is None:
        return {"rule_type": f"Must be one of {', '.join(RULE_TYPES)}."}
    return check(rule)


def _id_problem(rule: Rule) -> str | None:
    rule_id = rule.get("id")
    if rule_id is None:
        return None
    if isinstance(rule_id, bool) or not isinstance(rule_id, int):
        return "Must be a whole number."
    lowest = FIRST_CUSTOM_ID if rule.get("custom") else 0
    if not lowest <= rule_id <= _MAX_ID:
        return f"Must be between {lowest} and {_MAX_ID}."
    return None


def _label_problems(rule: Rule) -> Problems:
    problems: Problems = {}
    id_problem = _id_problem(rule)
    if id_problem:
        problems["id"] = id_problem
    name = rule.get("name")
    if name is not None and (not isinstance(name, str) or len(name) > MAX_TEXT_LENGTH):
        problems["name"] = f"Must be text of at most {MAX_TEXT_LENGTH} characters."
    return problems


def _time_zone_problems(rule: Rule) -> Problems:
    keys = ("source_tz", "report_tz")
    present = [key for key in keys if key in rule]
    required = keys if rule.get("transform_tz") else present
    problems: Problems = {}
    for key in required:
        problem = _time_zone_problem(rule.get(key))
        if problem:
            problems[key] = problem
    return problems


def _condition_exif_problem(value: object) -> str | None:
    if not isinstance(value, str) or _CONDITION_SEPARATOR not in value:
        return "Must be <tag>//<text>."
    tag, text = value.split(_CONDITION_SEPARATOR, maxsplit=1)
    if tag not in CONDITION_TAGS:
        return f"LibrePhotos cannot check the tag {tag!r} in a condition."
    return _text_problem(text)


def _condition_problems(rule: Rule) -> Problems:
    problems: Problems = {}
    for key in ("condition_path", "condition_filename"):
        problem = _text_problem(rule[key]) if key in rule else None
        if problem:
            problems[key] = problem
    if "condition_exif" in rule:
        problem = _condition_exif_problem(rule["condition_exif"])
        if problem:
            problems["condition_exif"] = problem
    return problems


def rule_problems(rule: object) -> Problems:
    """Why ``rule`` cannot be saved, by param; empty when it can."""
    if not isinstance(rule, dict):
        return {"rule": "A rule is an object."}
    return {
        **_type_problems(rule),
        **_label_problems(rule),
        **_time_zone_problems(rule),
        **_condition_problems(rule),
    }


def _as_list(value: object) -> list[object]:
    """A saved rule list: a list, or the JSON string of one (how the settings
    page sends it). Anything else is an empty list."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def changed_rule_problem(rules: object, saved: object) -> str | None:
    """Why ``rules`` cannot replace the ``saved`` list, in one sentence: the
    first new or changed rule that cannot be saved. None when they can."""
    unchanged = _as_list(saved)
    for position, rule in enumerate(_as_list(rules), start=1):
        if rule in unchanged:
            continue
        problems = rule_problems(rule)
        if problems:
            field, message = next(iter(problems.items()))
            name = rule.get("name") if isinstance(rule, dict) else None
            label = f"{name!r}" if isinstance(name, str) else f"number {position}"
            return f"Rule {label}: {field}: {message}"
    return None
