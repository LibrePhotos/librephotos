"""The timeline filter: which media a date-album listing shows (issue #2130).

One place turns a user plus request params into ``Q`` filters, so the day list
(``/api/albums/date/list/``), a day's pages (``/api/albums/date/<id>/``) and
server-side select-all (``build_photo_queryset``) agree on exactly which photos
are in view. If they did not, a day's placeholder count would not match its
pages, and "select all, then delete" could reach photos the timeline hid.

The filter has four keys, the same as ``User.default_timeline_filter``:

* ``media``: ``all``, ``photos`` (no videos) or ``videos``,
* ``hide_screenshots`` / ``hide_documents``: leave that media category out,
* ``favorites``: only photos rated at least ``User.favorite_min_rating``.

The user's saved default applies only when the request asks for it with
``apply_default``, so older clients and every other view keep their behaviour.
Explicit params then override the default key by key:

* ``media`` (``all``/``photos``/``videos``), or the older ``video`` / ``photo``,
* ``hide_screenshots`` / ``hide_documents``,
* ``favorite``: ``true`` shows only favorites, ``false`` turns a saved
  favorites-only default off,
* ``is_screenshot`` / ``is_document``: ``true`` shows only that category (the
  Screenshots page), ``false`` hides it.

Every flag is tri-state: a true word, a false word, or absent. These params
used to be read by truthiness, so ``?is_screenshot=false`` returned *only*
screenshots.
"""

from dataclasses import dataclass

from django.conf import settings
from django.db.models import Q

MEDIA_CHOICES = ("all", "photos", "videos")

#: The keys a saved ``User.default_timeline_filter`` may hold, and their type.
DEFAULT_FILTER_KEYS = {
    "media": str,
    "hide_screenshots": bool,
    "hide_documents": bool,
    "favorites": bool,
}

_FALSE_WORDS = {"false", "0", "no", "off"}


def parse_tristate(value):
    """``True``, ``False`` or ``None`` (absent) for a query-string or JSON flag.

    Only a false word (``false``, ``0``, ``no``, ``off``) is false. Any other
    non-empty value is true, the way any non-empty value switched these
    filters on before.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    word = "" if value is None else str(value).strip().lower()
    if not word:
        return None
    return word not in _FALSE_WORDS


@dataclass(frozen=True)
class TimelineFilter:
    """A resolved filter. ``screenshots`` / ``documents`` are ``any``,
    ``hide`` or ``only``; ``only`` is never saved as a default, it is what the
    Screenshots page asks for."""

    media: str = "all"
    screenshots: str = "any"
    documents: str = "any"
    favorites: bool = False

    def q(self, user, prefix=""):
        """Positive ``Q`` objects for this filter on ``<prefix>`` photo fields.

        Pass them to the same ``.filter()`` call as the rest of the photo
        conditions. With ``prefix="photos__"`` (a multi-valued join from
        ``AlbumDate``) an ``exclude()`` or ``~Q`` would drop every day that
        holds a single screenshot; ``Q(photos__is_screenshot=False)`` keeps
        the day and its other photos.
        """
        filters = []
        if self.media == "photos":
            filters.append(Q(**{f"{prefix}video": False}))
        elif self.media == "videos":
            filters.append(Q(**{f"{prefix}video": True}))
        for field, mode in (
            ("is_screenshot", self.screenshots),
            ("is_document", self.documents),
        ):
            if mode == "hide":
                filters.append(Q(**{f"{prefix}{field}": False}))
            elif mode == "only":
                filters.append(Q(**{f"{prefix}{field}": True}))
        if self.favorites:
            min_rating = getattr(
                user, "favorite_min_rating", settings.DEFAULT_FAVORITE_MIN_RATING
            )
            filters.append(Q(**{f"{prefix}rating__gte": min_rating}))
        return filters


def saved_default(user):
    """The user's saved default as a ``TimelineFilter``; invalid keys ignored.

    The serializer validates what is saved, but a value written past it (the
    admin, a shell) must never break the timeline.
    """
    saved = getattr(user, "default_timeline_filter", None)
    if not getattr(user, "is_authenticated", False) or not isinstance(saved, dict):
        return TimelineFilter()
    media = saved.get("media")
    return TimelineFilter(
        media=media if media in MEDIA_CHOICES else "all",
        screenshots="hide" if saved.get("hide_screenshots") is True else "any",
        documents="hide" if saved.get("hide_documents") is True else "any",
        favorites=saved.get("favorites") is True,
    )


def _media_override(params):
    media = params.get("media")
    if media in MEDIA_CHOICES:
        return media
    video = parse_tristate(params.get("video"))
    photo = parse_tristate(params.get("photo"))
    # ``video`` wins over ``photo``, as it always did.
    if video is not None:
        return "videos" if video else "photos"
    if photo is not None:
        return "photos" if photo else "videos"
    return None


def _category_override(params, only_param, hide_param):
    only = parse_tristate(params.get(only_param))
    if only is not None:
        return "only" if only else "hide"
    hide = parse_tristate(params.get(hide_param))
    if hide is not None:
        return "hide" if hide else "any"
    return None


def resolve_timeline_filter(user, params):
    """The filter for ``params`` (query params or a select-all ``query``)."""
    base = (
        saved_default(user)
        if parse_tristate(params.get("apply_default"))
        else TimelineFilter()
    )
    media = _media_override(params)
    screenshots = _category_override(params, "is_screenshot", "hide_screenshots")
    documents = _category_override(params, "is_document", "hide_documents")
    favorites = parse_tristate(params.get("favorite"))
    return TimelineFilter(
        media=base.media if media is None else media,
        screenshots=base.screenshots if screenshots is None else screenshots,
        documents=base.documents if documents is None else documents,
        favorites=base.favorites if favorites is None else favorites,
    )


def timeline_filter_q(user, params, prefix=""):
    """Shorthand: the ``Q`` filters for ``params``; see ``TimelineFilter.q``."""
    return resolve_timeline_filter(user, params).q(user, prefix=prefix)


def validate_default_timeline_filter(value):
    """Return ``value`` if it is a valid saved default; raise ``ValueError``.

    Every key is optional, unknown keys and values are refused, and flags must
    be JSON booleans (not ``"true"`` or ``1``).
    """
    if not isinstance(value, dict):
        raise ValueError("must be an object")
    unknown = set(value) - set(DEFAULT_FILTER_KEYS)
    if unknown:
        raise ValueError(f"unknown keys: {', '.join(sorted(unknown))}")
    for key, expected in DEFAULT_FILTER_KEYS.items():
        if key in value and type(value[key]) is not expected:
            raise ValueError(f"{key} must be a {expected.__name__}")
    if "media" in value and value["media"] not in MEDIA_CHOICES:
        raise ValueError(f"media must be one of {', '.join(MEDIA_CHOICES)}")
    return value
