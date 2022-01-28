import math
import os
import pathlib
import re
from datetime import datetime

import pytz

from api.exif_tags import Tags


def _regexp_group_range(a, b):
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
    _NOT_A_NUMBER +
    _REGEXP_DELIM.join(
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


def _extract_no_tz_datetime_from_str(x, regexp=REGEXP_NO_TZ):
    match = re.search(regexp, x)
    if not match:
        return None
    g = match.groups()
    return datetime(*map(int, g))


class RuleTypes:
    EXIF = "exif"
    PATH = "path"
    FILESYSTEM = "filesystem"


class TimeExtractionRule:
    """
    The goal is to help extract local time, but for historical reason it is expected the returned
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
    If a rule can't fetch the time (e.g. the exif tag value is not present or path doesn't match
    a regexp) then that rule is considered to be not applicable.

    In some cases it is known that the local time the rule would obtain is not in the desired
    timezone. E.g. video datetime tag QuickTime:CreateDate is by standard written in UTC rather
    than local time. For such cases each rule can optionally have setting "transform_tz" set to "1"
    - in that case this rule should also specify "source_tz" and "report_tz" settings where
    "source_tz" is describing the timezone that the rule is getting and "report_tz" is describing
    the timezone of the location where the photo/video was taken. Both "source_tz" and "report_tz"
    should be one of the follwing:
      - "utc" - UTC timezone
      - "gps_timezonefinder" - the timezone of the GPS location associated with the photo/video
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

    def __init__(self, params):
        self.rule_type = params["rule_type"]
        self.params = params

    def get_required_exif_tags(self):
        condition_tag, pattern = self._get_condition_exif()
        res = set()
        if condition_tag is not None:
            res.add(condition_tag)
        if self.rule_type == RuleTypes.EXIF:
            res.add(self.params["exif_tag"])
        return res

    def _get_no_tz_dt_from_tag(self, tag_name, exif_tags):
        tag_val = exif_tags.get(tag_name)
        if not tag_val:
            return None
        dt = _extract_no_tz_datetime_from_str(tag_val)
        return dt

    def _check_condition_path(self, path):
        if "condition_path" in self.params:
            return re.search(self.params["condition_path"], path) is not None
        else:
            return True

    def _check_condition_filename(self, path):
        if "condition_filename" in self.params:
            return (
                re.search(self.params["condition_filename"], pathlib.Path(path).name)
                is not None
            )
        else:
            return True

    def _get_condition_exif(self):
        val = self.params.get("condition_exif")
        if val is None:
            return None, None
        tag_and_pattern = val.split("//", maxsplit=1)
        if len(tag_and_pattern) != 2:
            raise ValueError(
                f"Value of condition_exif must contain '//' delimiter between tag name and patter: '{val}'"
            )
        tag, pattern = tag_and_pattern
        return tag, pattern

    def _check_condition_exif(self, exif_tags):
        tag, pattern = self._get_condition_exif()
        if tag:
            tag_value = exif_tags.get(tag)
            if not tag_value:
                return False
            return re.search(pattern, tag_value) is not None
        else:
            return True

    def _check_conditions(self, path, exif_tags, gps_lat, gps_lon):
        return (
            self._check_condition_exif(exif_tags)
            and self._check_condition_path(path)
            and self._check_condition_filename(path)
        )

    def apply(self, path, exif_tags, gps_lat, gps_lon):
        if not self._check_conditions(path, exif_tags, gps_lat, gps_lon):
            return None
        if self.rule_type == RuleTypes.EXIF:
            return self._apply_exif(exif_tags, gps_lat, gps_lon)
        elif self.rule_type == RuleTypes.PATH:
            return self._apply_path(path, gps_lat, gps_lon)
        elif self.rule_type == RuleTypes.FILESYSTEM:
            return self._apply_filesystem(path, gps_lat, gps_lon)
        else:
            raise ValueError(f"Unknown rule type {self.rule_type}")

    def _get_tz(self, description, gps_lat, gps_lon):
        if description == "gps_timezonefinder":
            if not _check_gps_ok(gps_lat, gps_lon):
                return None
            from timezonefinder import TimezoneFinder

            tzfinder = TimezoneFinder()
            tz_name = tzfinder.timezone_at(lng=gps_lon, lat=gps_lat)
            return pytz.timezone(tz_name) if tz_name else None
        elif description.lower() == "utc":
            return pytz.utc
        elif description.startswith("name:"):
            return pytz.timezone(description[5:])
        else:
            raise ValueError(f"Unkonwn tz description {description}")

    def _transform_tz(self, dt, gps_lat, gps_lon):
        if not dt:
            return None
        if self.params.get("transform_tz"):
            source_tz = self._get_tz(self.params["source_tz"], gps_lat, gps_lon)
            if not source_tz:
                return None
            report_tz = self._get_tz(self.params["report_tz"], gps_lat, gps_lon)
            if not report_tz:
                return None
            dt = dt.replace(tzinfo=source_tz).astimezone(report_tz)
        return dt.replace(tzinfo=pytz.utc)

    def _apply_exif(self, exif_tags, gps_lat, gps_lon):
        dt = self._get_no_tz_dt_from_tag(self.params["exif_tag"], exif_tags)
        return self._transform_tz(dt, gps_lat, gps_lon)

    def _apply_path(self, path, gps_lat, gps_lon):
        path_part = self.params.get("path_part")
        if path_part is None or path_part == "filename":
            source = pathlib.Path(path).name
        elif path_part == "full_path":
            source = path
        else:
            raise ValueError(f"Unknown path_part {path_part}")

        regexp = self.params.get("custom_regexp") or REGEXP_NO_TZ
        dt = _extract_no_tz_datetime_from_str(source, regexp)
        return self._transform_tz(dt, gps_lat, gps_lon)

    def _apply_filesystem(self, path, gps_lat, gps_lon):
        file_property = self.params.get("file_property")
        if file_property == "mtime":
            dt = datetime.fromtimestamp(os.path.getmtime(path))
        elif file_property == "ctime":
            dt = datetime.fromtimestamp(os.path.getctime(path))
        else:
            raise ValueError(f"Unknown file_property {file_property}")
        return self._transform_tz(dt, gps_lat, gps_lon)


def _check_gps_ok(lat, lon):
    return (
        lat is not None
        and lon is not None
        and math.isfinite(lat)
        and math.isfinite(lon)
        and (lat != 0.0 or lon != 0.0)
    )


DEFAULT_RULES_PARAMS = [
    # Local time from DATE_TIME_ORIGINAL exif tag
    {
        "id": 1,
        "name": "Local time from DATE_TIME_ORIGINAL exif tag",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.DATE_TIME_ORIGINAL,
    },
    # Get Video creation tag in UTC + figure out timezone using GPS coordinates
    {
        "id": 2,
        "name": "Get Video creation tag in UTC + figure out timezone using GPS coordinates",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.QUICKTIME_CREATE_DATE,
        "transform_tz": 1,
        "source_tz": "utc",
        "report_tz": "gps_timezonefinder",
    },
    # Using filename assuming time is local
    {
        "id": 3,
        "name": "Using filename assuming time is local",
        "rule_type": RuleTypes.PATH,
    },
    # Video UTC - report local time in UTC (since we can't find out actual timezone)
    {
        "id": 4,
        "name": "Video UTC - report local time in UTC (since we can't find out actual timezone)",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.QUICKTIME_CREATE_DATE,
    },
]

DEFAULT_RULES = list(map(TimeExtractionRule, DEFAULT_RULES_PARAMS))



def as_rules(configs):
    return list(map(TimeExtractionRule, configs))

def extract_local_date_time(path, rules, exif_getter, gps_lat, gps_lon):
    required_tags = set()
    for rule in rules:
        required_tags.update(rule.get_required_exif_tags())
    required_tags = list(required_tags)
    exif_values = exif_getter(required_tags)
    exif_tags = {k: v for k, v in zip(required_tags, exif_values)}
    for rule in rules:
        res = rule.apply(path, exif_tags, gps_lat, gps_lon)
        if res:
            return res
    return None
