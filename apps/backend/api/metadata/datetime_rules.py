from __future__ import annotations

import json
import logging
import math
import os
import pathlib
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, tzinfo
from typing import Any

import pytz

from api.metadata.tags import Tags

logger = logging.getLogger(__name__)


def _no_takeout_time() -> datetime | None:
    return None


@dataclass(frozen=True)
class RuleContext:
    """What a rule may use besides the file: the photo's GPS position, the
    owner's default timezone and the capture time of its Google Takeout JSON.

    ``takeout_taken_at`` is called only when a ``takeout_json`` rule is
    reached, so a photo the EXIF rules date never has its JSON looked up.
    """

    gps_lat: float | None
    gps_lon: float | None
    user_default_tz: str
    takeout_taken_at: Callable[[], datetime | None] = _no_takeout_time


def _regexp_group_range(a: int, b: int) -> str:
    return "(" + "|".join(f"{i:02}" for i in range(a, b)) + ")"


_REGEXP_GROUP_YEAR = r"((?:19|20|21)\d\d)"
_REGEXP_GROUP_MONTH = _regexp_group_range(1, 13)
_REGEXP_GROUP_DAY = _regexp_group_range(1, 32)
_REGEXP_GROUP_HOUR = _regexp_group_range(0, 24)
_REGEXP_GROUP_MIN = r"([0-5]\d)"
_REGEXP_GROUP_SEC = r"([0-5]\d)"
_REGEXP_DELIM = r"[-:_\., ]*"
_NOT_A_NUMBER = r"(?<!\d)"

REGEXP_NO_TZ = re.compile(
    _NOT_A_NUMBER
    + _REGEXP_DELIM.join(
        [
            _REGEXP_GROUP_YEAR,
            _REGEXP_GROUP_MONTH,
            _REGEXP_GROUP_DAY,
            _REGEXP_GROUP_HOUR,
            _REGEXP_GROUP_MIN,
            _REGEXP_GROUP_SEC,
        ]
    )
)

# WhatsApp style filename - like IMG-20220101-WA0007.jpg
# Here we get year, month, day from the filename and use the number as microsecond so that
# media is ordered by that number but all of these images are grouped together separated from
# other media on that date.
REGEXP_WHATSAPP = re.compile(r"^(?:IMG|VID)[-_](\d{4})(\d{2})(\d{2})(?:[-_]WA(\d+))?")
REGEXP_WHATSAPP_GROUP_MAPPING = ["year", "month", "day", "microsecond"]

PREDEFINED_REGEXPS: dict[str, tuple[re.Pattern[str], list[str] | None]] = {
    "default": (REGEXP_NO_TZ, None),
    "whatsapp": (REGEXP_WHATSAPP, REGEXP_WHATSAPP_GROUP_MAPPING),
}

REGEXP_GROUP_MAPPINGS = {
    "year": 0,
    "month": 1,
    "day": 2,
    "hour": 3,
    "minute": 4,
    "second": 5,
    "microsecond": 6,
}


def _datetime_from_parts(parts: list[int | None]) -> datetime:
    """datetime() of the parsed parts, year first; the time parts default to zero.

    A user's custom regexp can yield fewer than three or more than seven parts,
    or leave the year, month or day unmatched. That is raised as a ValueError,
    like an out-of-range part, so the rule counts as not matching instead of
    aborting the photo's scan.
    """
    if not 3 <= len(parts) <= 7:
        raise ValueError(f"datetime takes 3 to 7 arguments: {parts}")
    year, month, day = parts[0], parts[1], parts[2]
    if year is None or month is None or day is None:
        raise ValueError(f"datetime arguments are missing: {parts}")
    time_parts = [0 if part is None else part for part in parts[3:]] + [0, 0, 0, 0]
    hour, minute, second, microsecond = time_parts[:4]
    return datetime(year, month, day, hour, minute, second, microsecond)


def _extract_no_tz_datetime_from_str(
    x: object,
    regexp: str | re.Pattern[str] = REGEXP_NO_TZ,
    group_mapping: list[str] | None = None,
) -> datetime | None:
    # exiftool can hand back non-string tag values (e.g. a numeric Rating or
    # ISO), so coerce before matching - otherwise re.search raises TypeError,
    # which is not the ValueError handled below.
    match = re.search(regexp, str(x))
    if not match:
        return None
    g = match.groups()
    datetime_args: list[int | None] | tuple[str | None, ...]
    if group_mapping is None:
        datetime_args = g
    else:
        if len(g) > len(group_mapping):
            raise ValueError(
                f"Can't have more groups than group mapping values: {x}, regexp: {regexp}, mapping: {group_mapping}"
            )
        datetime_args = [
            None,
            None,
            None,
            0,
            0,
            0,
            0,
        ]  # year, month, day, hour, minute, second, microsecond
        for value, how_to_use in zip(g, group_mapping):
            if how_to_use not in REGEXP_GROUP_MAPPINGS:
                raise ValueError(
                    f"Group mapping {how_to_use} is unknown - must be one of {list(REGEXP_GROUP_MAPPINGS.keys())}"
                )
            ind = REGEXP_GROUP_MAPPINGS[how_to_use]
            # handle case when we have less groups than expected
            if value is not None:
                datetime_args[ind] = int(value)

    try:
        parsed_datetime = _datetime_from_parts(
            [None if part is None else int(part) for part in datetime_args]
        )
        delta = parsed_datetime - datetime.now()
        if delta.days > 30:
            logger.error(
                "Error while parsing datetime from '%s': Parsed datetime is %s in the future.",
                x,
                delta.days,
            )
            return None

        return parsed_datetime
    except ValueError:
        logger.error(
            "Error while trying to create datetime using '%s': datetime arguments %s. Regexp used: '%s'",
            x,
            datetime_args,
            regexp,
        )
        return None


class RuleTypes:
    EXIF = "exif"
    PATH = "path"
    FILESYSTEM = "filesystem"
    # The old "Timestamp set by user" rule (id 14). A date set by hand now
    # overrides every rule (``photo_datetime.extract_date_time``, #2254), so
    # the rule matches nothing; a list saved by an older client still loads.
    USER_DEFINED = "user_defined"
    # The capture time (UTC) in a Google Takeout JSON next to the file (#2270).
    TAKEOUT_JSON = "takeout_json"


class TimeExtractionRule:
    """The goal is to help extract local time, but for historical reason it is expected the returned
    datetime will have timezone to be set to pytz.utc (so local time + timezone equal to UTC)..

    Some sources of data might give us very rich information, e.g. timestamp + timezone,
    but others only allow to get local time (without knowing real timestamp).

    The logic for extracting local time is described as a list of rules that should be applied
    one after another until one rule is able to extract date time (or until all rules are tried
    without success).

    Currently supported rule types:
      - "exif" - local time is taken using exif tag params["exif_tag"] as obtained with exiftool
      - "path" - time is taken from the filename using a regular expression matching
        - if params["path_part"] is set to "full_path" then full path (as seen by backend container)
          is used for regexp matching instead of just fileanme.
        - if params["custom_regexp"] is specified - that regexp is used instead of default one
          (it is still expecting 6 groups to be matched: year, month, day, hour, minute, second).
      - "fs" - time is taken from file property. Since these are unix timestamps without timezones
        they are always translated to local time using UTC.
        - params["file_property"] must be specified and equal to one of the following:
          - "mtime" - for file modifided time
          - "ctime" - for file created time
      - "takeout_json" - the UTC capture time (``photoTakenTime``) in the Google Takeout JSON
        next to the file (``api.metadata.takeout``). Like "fs" it is a timestamp, so it is
        reported in UTC unless the rule transforms it.
    If a rule can't fetch the time (e.g. the exif tag value is not present or path doesn't match
    a regexp) then that rule is considered to be not applicable.

    In some cases it is known that the local time the rule would obtain is not in the desired
    timezone. E.g. video datetime tag QuickTime:CreateDate is by standard written in UTC rather
    than local time. For such cases each rule can optionally have setting "transform_tz" set to "1"
    - in that case this rule should also specify "source_tz" and "report_tz" settings where
    "source_tz" is describing the timezone that the rule is getting and "report_tz" is describing
    the timezone of the location where the photo/video was taken. Both "source_tz" and "report_tz"
    should be one of the following:
      - "utc" - UTC timezone
      - "gps_timezonefinder" - the timezone of the GPS location associated with the photo/video
      - "server_local" - the timezone of the librephotos server - not very useful since we run docker containers in UTC timezone.
      - "user_default" - user default timezone
      - "name:<timezone_name>" - the timezone with the name <timezone_name>
    If either "source_tz" or "report_tz" could not be obtained the rule is considered to be not applicable.

    Additionally each rule can have condition specifications that limits the rule application
    to only the photos/videos that meet the condition's requirement. Supported conditions:
      - "condition_path": "<regexp>" - rule only applied to files with full path (as seen by backend)
                                       matching the regexp
      - "condition_filename": "<regexp>" - rule only applied to files with filename matching the regexp
      - "condition_exif": "<tag_name>//<regexp>" - first "//" is considered end of tag name and the rule is only
                                          applied if value of tag <tag_name> exists and matches the regexp.

    If multiple conditions are provided the rule is considered applicable only if all of them are met.

    Examples of the rules:
      - Take local time from exif tag "EXIF:DateTimeOriginal" if it is available:

            {
                "rule_type": "exif",
                "exif_tag": "EXIF:DateTimeOriginal",
            }

      - Take UTC time using tag "QuickTime:CreateDate" and convert it from UTC
        to timezone associated with the GPS coordinates (only applies if both
        tag value and GPS coordinates are available):

            {
                "rule_type": "exif",
                "exif_tag": "QuickTime:CreateDate",
                "transform_tz": 1,
                "source_tz": "utc",
                "report_tz": "gps_timezonefinder",
            }

      - Look at the filename and try to extract time from it - treat it as local time
        (it is known that some devices are not using local time here - e.g. some phones
        might use UTC time for video filenames):

            {
                "rule_type": "path",
            }

      - Take UTC time time using tag "QuickTime:CreateDate" and convert it from UTC
        to a fixed timezone "Europe/Moscow" to get local time. Only apply to files
        which path contains "Moscow_Visit" or "FromMoscow":

            {
                "rule_type": "exif",
                "exif_tag": "QuickTime:CreateDate",
                "transform_tz": 1,
                "source_tz": "utc",
                "report_tz": "name:Europe/Moscow",
                "condition_path": "(Moscow_Visit|FromMoscow)",
            }

      - Take modified time of the file and get local time using timezone associated
        with the GPS location. Only apply to files with "EXIF:Model" exif tag
        containing "FooBar":

            {
                "rule_type": "filesystem",
                "file_property": "mtime",
                "transform_tz": 1,
                "source_tz": "utc",
                "report_tz": "gps_timezonefinder",
                "condition_exif": "EXIF:Model//FooBar"
            }
    """

    def __init__(self, params: dict[str, Any]) -> None:
        self.rule_type = params["rule_type"]
        self.params = params

    def get_required_exif_tags(self) -> set[str]:
        condition_tag, pattern = self._get_condition_exif()
        res: set[str] = set()
        if condition_tag is not None:
            res.add(condition_tag)
        if self.rule_type == RuleTypes.EXIF:
            res.add(self.params["exif_tag"])
        return res

    def _get_no_tz_dt_from_tag(
        self, tag_name: str, exif_tags: dict[str, object]
    ) -> datetime | None:
        tag_val = exif_tags.get(tag_name)
        if not tag_val:
            return None
        dt = _extract_no_tz_datetime_from_str(tag_val)
        return dt

    def _check_condition_path(self, path: str) -> bool:
        if "condition_path" in self.params:
            return re.search(self.params["condition_path"], path) is not None
        else:
            return True

    def _check_condition_filename(self, path: str) -> bool:
        if "condition_filename" in self.params:
            return (
                re.search(self.params["condition_filename"], pathlib.Path(path).name)
                is not None
            )
        else:
            return True

    def _get_condition_exif(self) -> tuple[str | None, str | None]:
        val = self.params.get("condition_exif")
        if val is None:
            return None, None
        tag_and_pattern = val.split("//", maxsplit=1)
        if len(tag_and_pattern) != 2:
            raise ValueError(
                f"Value of condition_exif must contain '//' delimiter between tag name and pattern: '{val}'"
            )
        tag, pattern = tag_and_pattern
        return tag, pattern

    def _check_condition_exif(self, exif_tags: dict[str, object]) -> bool:
        tag, pattern = self._get_condition_exif()
        if tag and pattern is not None:
            tag_value = exif_tags.get(tag)
            if not tag_value:
                return False
            # tag_value may be numeric (see _extract_no_tz_datetime_from_str).
            return re.search(pattern, str(tag_value)) is not None
        else:
            return True

    def _check_conditions(
        self,
        path: str,
        exif_tags: dict[str, object],
        gps_lat: float | None,
        gps_lon: float | None,
    ) -> bool:
        return (
            self._check_condition_exif(exif_tags)
            and self._check_condition_path(path)
            and self._check_condition_filename(path)
        )

    def apply(
        self, path: str, exif_tags: dict[str, object], context: RuleContext
    ) -> datetime | None:
        gps_lat, gps_lon = context.gps_lat, context.gps_lon
        user_default_tz = context.user_default_tz
        if not self._check_conditions(path, exif_tags, gps_lat, gps_lon):
            return None
        if self.rule_type == RuleTypes.EXIF:
            return self._apply_exif(exif_tags, gps_lat, gps_lon, user_default_tz)
        elif self.rule_type == RuleTypes.PATH:
            return self._apply_path(path, gps_lat, gps_lon, user_default_tz)
        elif self.rule_type == RuleTypes.FILESYSTEM:
            return self._apply_filesystem(path, gps_lat, gps_lon, user_default_tz)
        elif self.rule_type == RuleTypes.TAKEOUT_JSON:
            return self._apply_takeout_json(context)
        elif self.rule_type == RuleTypes.USER_DEFINED:
            return None
        else:
            raise ValueError(f"Unknown rule type {self.rule_type}")

    def _get_tz(
        self,
        description: str,
        gps_lat: float | None,
        gps_lon: float | None,
        user_default_tz: str,
    ) -> tuple[bool, tzinfo | None]:
        """None is a valid timezone returned here (meaning that we want to use server local time).
        This is why this function returns a tuple with the first element specifying success of
        determining the timezone, and the second element - the timezone itself.
        """
        if description == "gps_timezonefinder":
            return _get_gps_tz(gps_lat, gps_lon)
        if description == "user_default":
            return (True, pytz.timezone(user_default_tz))
        if description == "server_local":
            return (True, None)
        if description.lower() == "utc":
            return (True, pytz.utc)
        if description.startswith("name:"):
            return (True, pytz.timezone(description[5:]))
        raise ValueError(f"Unknown tz description {description}")

    def _transform_tz(
        self,
        dt: datetime | None,
        gps_lat: float | None,
        gps_lon: float | None,
        user_default_tz: str,
    ) -> datetime | None:
        if not dt:
            return None
        if self.params.get("transform_tz"):
            has_source_tz, source_tz = self._get_tz(
                self.params["source_tz"], gps_lat, gps_lon, user_default_tz
            )
            if not has_source_tz:
                return None
            has_report_tz, report_tz = self._get_tz(
                self.params["report_tz"], gps_lat, gps_lon, user_default_tz
            )
            if not has_report_tz:
                return None
            # Either of source_tz or report_tz might be None - meaning that we want to use
            # server local timezone
            dt = datetime.fromtimestamp(
                dt.replace(tzinfo=source_tz).timestamp(), report_tz
            )
        return dt.replace(tzinfo=pytz.utc)

    def _apply_exif(
        self,
        exif_tags: dict[str, object],
        gps_lat: float | None,
        gps_lon: float | None,
        user_default_tz: str,
    ) -> datetime | None:
        dt = self._get_no_tz_dt_from_tag(self.params["exif_tag"], exif_tags)
        return self._transform_tz(dt, gps_lat, gps_lon, user_default_tz)

    def _apply_path(
        self,
        path: str,
        gps_lat: float | None,
        gps_lon: float | None,
        user_default_tz: str,
    ) -> datetime | None:
        path_part = self.params.get("path_part")
        if path_part is None or path_part == "filename":
            source = pathlib.Path(path).name
        elif path_part == "full_path":
            source = path
        else:
            raise ValueError(f"Unknown path_part {path_part}")

        group_mapping: list[str] | None = None
        regexp = self.params.get("custom_regexp")
        if not regexp:
            predefined_regexp_type = self.params.get("predefined_regexp", "default")
            if predefined_regexp_type not in PREDEFINED_REGEXPS:
                raise ValueError(
                    f"Unknown predefined regexp type {predefined_regexp_type}"
                )
            regexp, group_mapping = PREDEFINED_REGEXPS[predefined_regexp_type]
        dt = _extract_no_tz_datetime_from_str(source, regexp, group_mapping)
        return self._transform_tz(dt, gps_lat, gps_lon, user_default_tz)

    def _apply_filesystem(
        self,
        path: str,
        gps_lat: float | None,
        gps_lon: float | None,
        user_default_tz: str,
    ) -> datetime | None:
        file_property = self.params.get("file_property")
        if file_property == "mtime":
            dt = datetime.fromtimestamp(os.path.getmtime(path), pytz.utc)
        elif file_property == "ctime":
            dt = datetime.fromtimestamp(os.path.getctime(path), pytz.utc)
        else:
            raise ValueError(f"Unknown file_property {file_property}")
        return self._transform_tz(dt, gps_lat, gps_lon, user_default_tz)

    def _apply_takeout_json(self, context: RuleContext) -> datetime | None:
        taken_at = context.takeout_taken_at()
        if taken_at is None:
            return None
        # _transform_tz reads a naive time in source_tz; this one is UTC.
        utc = datetime.fromtimestamp(taken_at.timestamp(), pytz.utc)
        return self._transform_tz(
            utc.replace(tzinfo=None),
            context.gps_lat,
            context.gps_lon,
            context.user_default_tz,
        )


def _get_gps_tz(lat: float | None, lon: float | None) -> tuple[bool, tzinfo | None]:
    if lat is None or lon is None or not _check_gps_ok(lat, lon):
        return (False, None)
    from timezonefinder import TimezoneFinder

    tz_name = TimezoneFinder().timezone_at(lng=lon, lat=lat)
    return (True, pytz.timezone(tz_name)) if tz_name else (False, None)


def _check_gps_ok(lat: float | None, lon: float | None) -> bool:
    return (
        lat is not None
        and lon is not None
        and math.isfinite(lat)
        and math.isfinite(lon)
        and (lat != 0.0 or lon != 0.0)
    )


ALL_TIME_ZONES = pytz.all_timezones

# Id 14 was "Timestamp set by user"; migration 0167 removed it from saved
# lists. Do not reuse it.
DEFAULT_RULES_PARAMS: list[dict[str, Any]] = [
    {
        "id": 16,
        "name": f"Local time from {Tags.DATE_CREATED} tag (set by LibrePhotos or other photo managers)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.DATE_CREATED,
    },
    {
        "id": 1,
        "name": f"Local time from {Tags.DATE_TIME_ORIGINAL} exif tag",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.DATE_TIME_ORIGINAL,
    },
    {
        "id": 15,
        "name": f"Local time from {Tags.DATE_TIME} exif tag",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.DATE_TIME,
    },
    {
        "id": 17,
        "name": f"Local time from the video's {Tags.QUICKTIME_CREATION_DATE} tag (phones)",
        "rule_type": RuleTypes.EXIF,
        # The value carries its UTC offset ("2024:04:03 03:00:00-07:00"). The
        # date regexp drops it, which is right here: what is left is the local
        # time the video was shot at.
        "exif_tag": Tags.QUICKTIME_CREATION_DATE,
    },
    {
        "id": 2,
        "name": "Get Video creation tag in UTC + figure out timezone using GPS coordinates",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.QUICKTIME_CREATE_DATE,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "gps_timezonefinder",
    },
    {
        "id": 18,
        "name": "Get MKV/WebM creation date in UTC + figure out timezone using GPS coordinates",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.MATROSKA_DATE,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "gps_timezonefinder",
    },
    {
        "id": 11,
        "name": f"Use {Tags.GPS_DATE_TIME} tag + figure out timezone using GPS coordinates",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.GPS_DATE_TIME,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "gps_timezonefinder",
    },
    # Before the file name, which a Takeout export keeps from the phone or
    # replaces, after every tag of the file itself (#2270).
    {
        "id": 20,
        "name": "Google Takeout JSON capture time in UTC + figure out timezone using GPS coordinates",
        "rule_type": RuleTypes.TAKEOUT_JSON,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "gps_timezonefinder",
    },
    {
        "id": 21,
        "name": "Google Takeout JSON capture time in user default timezone (can't find out actual timezone)",
        "rule_type": RuleTypes.TAKEOUT_JSON,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "user_default",
    },
    {
        "id": 3,
        "name": "Using filename assuming time is local (most of filenames auto generated by smartphones etc)",
        "rule_type": RuleTypes.PATH,
    },
    {
        "id": 4,
        "name": "Video creation datetime in user default timezone (can't find out actual timezone)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.QUICKTIME_CREATE_DATE,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "user_default",
    },
    {
        "id": 19,
        "name": "MKV/WebM creation date in user default timezone (can't find out actual timezone)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.MATROSKA_DATE,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "user_default",
    },
    {
        "id": 5,
        "name": "Extract date using WhatsApp file name",
        "rule_type": RuleTypes.PATH,
        "predefined_regexp": "whatsapp",
    },
]

OTHER_RULES_PARAMS: list[dict[str, Any]] = [
    {
        "id": 6,
        "name": "Video creation datetime in UTC timezone (can't find out actual timezone)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.QUICKTIME_CREATE_DATE,
    },
    {
        "id": 7,
        "name": "File modified time in user default timezone",
        "rule_type": RuleTypes.FILESYSTEM,
        "file_property": "mtime",
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "user_default",
    },
    {
        "id": 8,
        "name": "File modified time in UTC timezone",
        "rule_type": RuleTypes.FILESYSTEM,
        "file_property": "mtime",
    },
    {
        "id": 9,
        "name": "File created time in user default timezone",
        "rule_type": RuleTypes.FILESYSTEM,
        "file_property": "ctime",
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "user_default",
    },
    {
        "id": 10,
        "name": "File created time in UTC timezone",
        "rule_type": RuleTypes.FILESYSTEM,
        "file_property": "ctime",
    },
    {
        "id": 12,
        "name": f"Use {Tags.GPS_DATE_TIME} tag in user default timezone (can't find out actual timezone)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.GPS_DATE_TIME,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "user_default",
    },
    {
        "id": 13,
        "name": f"Use {Tags.GPS_DATE_TIME} tag in UTC timezone (can't find out actual timezone)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.GPS_DATE_TIME,
    },
]


def rules_json(configs: object) -> str:
    """A rule list as JSON for the API: the date/time and burst rule settings.

    A value the encoder does not know (a rule object) is written as its
    attributes. ``api.stacks.burst_rules`` uses it for the burst rules.
    """
    return json.dumps(configs, default=lambda x: x.__dict__)


def set_as_default_rule(rule: dict[str, Any]) -> dict[str, Any]:
    rule["is_default"] = True
    return rule


def set_as_other_rule(rule: dict[str, Any]) -> dict[str, Any]:
    rule["is_default"] = False
    return rule


PREDEFINED_RULES_PARAMS = list(map(set_as_default_rule, DEFAULT_RULES_PARAMS)) + list(
    map(set_as_other_rule, OTHER_RULES_PARAMS)
)


DEFAULT_RULES_JSON = rules_json(DEFAULT_RULES_PARAMS)
PREDEFINED_RULES_JSON = rules_json(PREDEFINED_RULES_PARAMS)
ALL_TIME_ZONES_JSON = rules_json(ALL_TIME_ZONES)


def as_rules(configs: list[dict[str, Any]]) -> list[TimeExtractionRule]:
    return list(map(TimeExtractionRule, configs))


def extract_local_date_time(
    path: str,
    rules: list[TimeExtractionRule],
    exif_getter: Callable[[list[str]], Sequence[object]],
    context: RuleContext,
) -> datetime | None:
    required_tags: set[str] = set()
    for rule in rules:
        required_tags.update(rule.get_required_exif_tags())
    tag_names = list(required_tags)
    exif_values = exif_getter(tag_names)
    exif_tags = {k: v for k, v in zip(tag_names, exif_values)}
    for rule in rules:
        res = rule.apply(path, exif_tags, context)
        if res:
            return res
    return None
