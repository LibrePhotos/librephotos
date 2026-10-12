"""The search term examples the search bar suggests to a user.

They come from a random sample of the user's captioned photos: a photo's
places, year, OpenCLIP tags and people, alone and combined.
"""

import logging
import random
from typing import TypeVar

from api.models import Photo, User
from api.search.semantic import OPENCLIP

logger = logging.getLogger(__name__)

_T = TypeVar("_T")

DEFAULT_SEARCH_TERMS = [
    "for people",
    "for places",
    "for things",
    "for time",
    "for file path or file name",
]

# How many captioned photos the examples are drawn from.
SAMPLE_SIZE = 100

# A photo's terms by kind; a single term of each kind is suggested.
KINDS = ("loc", "time", "things", "people")

# Kinds suggested together, with the threshold random.random() has to beat.
COMBINATIONS: tuple[tuple[tuple[str, ...], float], ...] = (
    (("loc", "people"), 0.3),
    (("time", "people"), 0.3),
    (("people", "things"), 0.9),
    (("loc", "people", "time", "things"), 0.95),
    (("loc", "time"), 0.3),
    (("loc", "things"), 0.9),
    (("time", "things"), 0.9),
)


def shuffle(items: list[_T]) -> list[_T]:
    random.shuffle(items)
    return items


def _sample_photos(user: User) -> list[Photo] | None:
    """Up to ``SAMPLE_SIZE`` of the user's captioned photos, None on a bad query."""
    captioned = (
        Photo.objects.owned_by(user)
        .exclude(caption_instance__captions_json={})
        .exclude(caption_instance__captions_json__isnull=True)
    )
    possible_ids = list(captioned[:1000].values_list("image_hash", flat=True))
    if len(possible_ids) >= SAMPLE_SIZE:
        possible_ids = random.choices(possible_ids, k=SAMPLE_SIZE)
    logger.info("%s possible ids", len(possible_ids))
    try:
        return list(
            captioned.filter(image_hash__in=possible_ids).prefetch_related(
                "faces", "faces__person", "caption_instance"
            )
        )
    except ValueError:
        return None


def _photo_terms(photo: Photo) -> dict[str, list[str]]:
    """The photo's search terms by kind (see ``KINDS``)."""
    places: list[str] = []
    geolocation = photo.geolocation_json
    if geolocation and "features" in geolocation:
        places = [
            feature["text"]
            for feature in geolocation["features"][-5:]
            if "text" in feature and not feature["text"].isdigit()
        ]
    tags: list[str] = []
    # caption_instance is a reverse one-to-one; the sample excludes photos
    # without captions, so the accessor never raises here.
    if photo.caption_instance.captions_json:
        tag_result = photo.caption_instance.captions_json.get(OPENCLIP)
        if tag_result is not None:
            tags = tag_result.get("tags", [])
    return {
        "loc": places,
        "time": [str(photo.exif_timestamp.year)] if photo.exif_timestamp else [],
        "things": tags,
        "people": [
            face.person.name.split(" ")[0] if face.person else ""
            for face in photo.faces.all()
        ],
    }


def _suggestions(terms: dict[str, list[str]]) -> list[str]:
    """One random term of each kind, and some random combinations of them."""
    picked = {kind: random.choice(terms[kind]) if terms[kind] else "" for kind in KINDS}
    suggestions = [picked[kind] for kind in KINDS if picked[kind]]
    for kinds, threshold in COMBINATIONS:
        combined = " ".join(shuffle([picked[kind] for kind in kinds]))
        if random.random() > threshold:
            suggestions.append(combined)
    return suggestions


def get_search_term_examples(user: User) -> list[str]:
    samples = _sample_photos(user)
    if samples is None:
        return list(DEFAULT_SEARCH_TERMS)
    logger.info("Getting search terms for user %s", user.id)
    logger.info("Found %s photos", len(samples))
    if not samples:
        search_terms = DEFAULT_SEARCH_TERMS
    else:
        search_terms = [
            term for photo in samples for term in _suggestions(_photo_terms(photo))
        ]
    return [term for term in {term.strip() for term in search_terms} if term]
