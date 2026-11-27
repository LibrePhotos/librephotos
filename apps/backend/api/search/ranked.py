from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

import requests
from django.db.models import F, Q, QuerySet

from api.lazy_import import LazyModule
from api.models import AlbumPlace, Person, Photo, User, UserPlace
from api.search.hybrid import FusionSettings, cut_semantic, fuse
from api.search.lexical import lexical_matches
from api.search.metadata_filter import people_q
from api.search.query_parser import DateSpec, ParsedQuery, Vocabulary, parse
from api.search.semantic import SEARCH_COSINE_FLOOR, calculate_query_embeddings
from api.search.similarity import search_ranked_embedding
from api.search.translate import lexicon_for
from api.sharing.library_search import LibrarySearch

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

FUSION = FusionSettings(semantic_floor=SEARCH_COSINE_FLOOR)
SEMANTIC_POOL = 2000
LEXICAL_LIMIT = 1000
MAX_RESULTS = 5000
MIN_FIRST_NAME = 3
NO_LIBRARIES = LibrarySearch()
DEFAULT_TOPK = 100


def vocabulary(user: User, language: str = "") -> Vocabulary:
    people: dict[str, int] = {}
    by_first_name: dict[str, set[int]] = defaultdict(set)
    named = (
        Person.objects.owned_by(user)
        .filter(kind=Person.KIND_USER)
        .values_list("name", "id")
    )
    for name, person_id in named:
        if not name:
            continue
        people[name] = person_id
        first = name.split()[0]
        if len(first) >= MIN_FIRST_NAME:
            by_first_name[first].add(person_id)
    for first, ids in by_first_name.items():
        if len(ids) == 1 and first not in people:
            people[first] = next(iter(ids))
    places = [
        *AlbumPlace.objects.owned_by(user).values_list("title", flat=True),
        *UserPlace.objects.owned_by(user).values_list("name", flat=True),
    ]
    return Vocabulary(people=people, places=places, translations=lexicon_for(language))


def date_q(spec: DateSpec) -> Q:
    query = Q()
    if spec.years:
        query &= Q(exif_timestamp__year__in=spec.years)
    if spec.months:
        query &= Q(exif_timestamp__month__in=spec.months)
    return query


def place_q(user: User, place: str) -> Q:
    albums = AlbumPlace.objects.owned_by(user).filter(title__iexact=place)
    in_albums = AlbumPlace.photos.through.objects.filter(albumplace__in=albums)
    named = UserPlace.objects.owned_by(user).filter(name__iexact=place)
    in_named = UserPlace.photos.through.objects.filter(userplace__in=named)
    return Q(pk__in=in_albums.values("photo_id")) | Q(
        pk__in=in_named.values("photo_id")
    )


def parsed_q(user: User, parsed: ParsedQuery) -> list[Q]:
    found = [date_q(spec) for spec in parsed.dates]
    found += people_q(list(parsed.people))
    found += [place_q(user, place) for place in parsed.places]
    return found


def _newest(queryset: QuerySet[Photo]) -> list[UUID]:
    ordered = queryset.order_by("-exif_timestamp", "pk")
    return list(ordered.values_list("pk", flat=True)[:MAX_RESULTS])


def _scored_rows(
    owner_id: int,
    photos: QuerySet[Photo],
    embedding: Sequence[float],
    pool: int,
) -> list[tuple[UUID, float]]:
    scored = search_ranked_embedding(owner_id, embedding, pool, FUSION.semantic_floor)
    rows = dict(
        photos.filter(image_hash__in=[h for h, _ in scored]).values_list(
            "image_hash", "pk"
        )
    )
    return [(rows[h], score) for h, score in scored if h in rows]


@dataclass(frozen=True)
class RankedSearch:
    user: User
    libraries: LibrarySearch = NO_LIBRARIES
    like: Sequence[float] | None = None

    @property
    def topk(self) -> int:
        return self.user.semantic_search_topk or DEFAULT_TOPK


def _unit(vector: Sequence[float]) -> npt.NDArray[np.float32]:
    array = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(array))
    return array / norm if norm > 0 else array


def _query_embedding(
    parsed: ParsedQuery, like: Sequence[float] | None
) -> Sequence[float] | None:
    if not parsed.semantic_text:
        return like
    try:
        text, _ = calculate_query_embeddings(parsed.semantic_text)
    except (requests.RequestException, KeyError, ValueError) as error:
        logger.warning("semantic search unavailable, using words only: %s", error)
        return like
    if like is None:
        return text
    combined: list[float] = (_unit(like) + _unit(text)).tolist()
    return combined


def _semantic(
    search: RankedSearch,
    queryset: QuerySet[Photo],
    parsed: ParsedQuery,
    embedding: Sequence[float],
) -> list[UUID]:
    user, topk = search.user, search.topk
    pool = max(SEMANTIC_POOL if parsed.has_filters else topk, topk)
    inside = _scored_rows(user.id, queryset, embedding, pool)
    filters = parsed_q(user, parsed)
    for library in search.libraries.libraries:
        shown = library.photos.filter(*filters)
        inside += _scored_rows(library.owner_id, shown, embedding, pool)
    inside.sort(key=lambda row: -row[1])
    if parsed.has_filters:
        return [pk for pk, _ in inside]
    kept = cut_semantic(inside, FUSION.semantic_floor)
    return kept[:topk]


def _shared_words(libraries: LibrarySearch) -> list[UUID]:
    matches = libraries.word_matches()
    if matches is None:
        return []
    ordered = matches.order_by("-exif_timestamp", "pk")
    return list(ordered.values_list("pk", flat=True)[:LEXICAL_LIMIT])


def _lexical(
    search: RankedSearch, filtered: QuerySet[Photo], parsed: ParsedQuery
) -> list[UUID]:
    own_words = list(
        lexical_matches(filtered, parsed.terms, parsed.phrases)
        .order_by(F("lexical_score").desc(), F("exif_timestamp").desc(), "pk")
        .values_list("pk", flat=True)[:LEXICAL_LIMIT]
    )
    return fuse(own_words, _shared_words(search.libraries), FUSION)


def _ranked(
    search: RankedSearch, queryset: QuerySet[Photo], parsed: ParsedQuery
) -> list[UUID]:
    filtered = queryset.filter(*parsed_q(search.user, parsed))
    has_words = bool(parsed.terms or parsed.phrases)
    if not has_words and search.like is None:
        shared_words = _shared_words(search.libraries)
        return fuse(_newest(filtered), shared_words, FUSION)[:MAX_RESULTS]
    lexical = _lexical(search, filtered, parsed) if has_words else []
    embedding = (
        _query_embedding(parsed, search.like)
        if parsed.semantic_text or search.like is not None
        else None
    )
    semantic = (
        _semantic(search, filtered, parsed, embedding) if embedding is not None else []
    )
    if parsed.phrases:
        allowed = set(lexical)
        semantic = [pk for pk in semantic if pk in allowed]
    return fuse(lexical, semantic, FUSION)[:MAX_RESULTS]


def ranked_photo_ids(
    search: RankedSearch, queryset: QuerySet[Photo], text: str, language: str = ""
) -> list[UUID]:
    user = search.user
    words = vocabulary(user, language)
    parsed = parse(text, words)
    found = _ranked(search, queryset, parsed)
    if not parsed.places:
        return found
    without_places = Vocabulary(people=words.people, translations=words.translations)
    seen = set(found)
    more = _ranked(search, queryset, parse(text, without_places))
    return [*found, *(pk for pk in more if pk not in seen)][:MAX_RESULTS]
