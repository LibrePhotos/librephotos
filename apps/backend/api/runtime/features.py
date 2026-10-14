"""Whether an optional feature runs: the environment switch, then the site setting.

Two layers (#2217). ``FEATURE_<NAME>`` in the environment is a hard off: a
deployment that sets it to false keeps the feature off whatever the site
settings say, and the site switch is shown locked (``feature_locked``). While
the environment allows a feature, the admin's ``<NAME>_ENABLED`` site setting
decides, so it can be turned off and on again without a restart.

Some gates run once per file (``is_valid_media``) or per photo
(``extract_faces``), and constance's database backend costs a query per read.
So the site switches are read together in one query and kept in the
process for ``CACHE_SECONDS``. A change saved in this process (the site
settings view, ``override_config`` in a test) drops that copy at once through
constance's ``config_updated`` signal; other processes, the django-q workers
among them, see it within ``CACHE_SECONDS``.
"""

import time
from dataclasses import dataclass
from typing import Literal, get_args

from django.conf import settings
from django.db import DatabaseError

Feature = Literal[
    "VIDEO",
    "FACE_DETECTION",
    "FACE_CLUSTER",
    "IMAGE_CAPTIONING",
    "REVERSE_GEOCODING",
    "SCENE_CLASSIFICATION",
    # The animated grid previews of videos (#649); off, a video's square
    # thumbnails are a still frame. Needs VIDEO to matter at all.
    "VIDEO_PREVIEWS",
]
FEATURES: tuple[Feature, ...] = get_args(Feature)

# How long a process keeps the site switches it read.
CACHE_SECONDS = 60.0


@dataclass
class _SiteSwitches:
    values: dict[str, bool] | None = None
    read_at: float = 0.0


_cache = _SiteSwitches()


def env_flag_name(feature: Feature) -> str:
    """The environment variable (and Django setting) that can lock it off."""
    return f"FEATURE_{feature}"


def site_setting_key(feature: Feature) -> str:
    """The constance key of the feature's switch in the site settings."""
    return f"{feature}_ENABLED"


def feature_locked(feature: Feature) -> bool:
    """Whether the environment turned the feature off, out of the admin's reach.

    A setting the settings module does not define counts as on, so an
    unrecognised switch can never take a feature away.
    """
    return not bool(getattr(settings, env_flag_name(feature), True))


def feature_enabled(feature: Feature) -> bool:
    """Whether the feature runs: the environment allows it, the site setting is on."""
    if feature_locked(feature):
        return False
    return _site_switches().get(feature, True)


def forget_site_switches(**kwargs: object) -> None:
    """Drop this process's copy of the site switches; the next read queries.

    A test that writes a switch through constance (a POST to the site settings,
    ``config.X = ...``) gets the signal on the write, but not on the rollback
    at its end: it calls this in a cleanup, or uses ``override_config``, which
    writes the old value back.
    """
    _cache.values = None


def register() -> None:
    """Drop the copy whenever this process saves a site setting."""
    from constance.signals import config_updated

    config_updated.connect(
        forget_site_switches,
        dispatch_uid="api.runtime.features.forget_site_switches",
    )


def _site_switches() -> dict[str, bool]:
    """The site switches by feature, from the cache while it is fresh.

    A configuration the process cannot read counts as on and is not cached:
    a database that is not up yet must not be able to take a feature away,
    and the next call tries again. Only a database error fails open.
    """
    now = time.monotonic()
    if _cache.values is not None and now - _cache.read_at < CACHE_SECONDS:
        return _cache.values
    try:
        values = _read_site_switches()
    except DatabaseError:
        return {}
    _cache.values, _cache.read_at = values, now
    return values


def _read_site_switches() -> dict[str, bool]:
    """All the site switches in one query; an unsaved one is its default (on)."""
    from constance import config as site_config
    from constance import settings as constance_settings

    keys = [site_setting_key(feature) for feature in FEATURES]
    stored = site_config._backend.mget(keys)
    return {
        feature: bool(
            stored[key]
            if stored.get(key) is not None
            else constance_settings.CONFIG[key][0]
        )
        for feature, key in zip(FEATURES, keys, strict=True)
    }
