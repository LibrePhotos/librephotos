from __future__ import annotations

import logging
from collections import defaultdict
from uuid import UUID

import requests
from django.db.models import F, Q, QuerySet

from api.models import AlbumPlace, Person, Photo, User, UserPlace
from api.search.hybrid import FusionSettings, cut_semantic, fuse
from api.search.lexical import lexical_matches
from api.search.metadata_filter import people_q
from api.search.query_parser import DateSpec, ParsedQuery, Vocabulary, parse
from api.search.semantic import SEARCH_COSINE_FLOOR, calculate_query_embeddings
from api.search.similarity import search_ranked_embedding
from api.search.translate import lexicon_for

logger = logging.getLogger(__name__)

FUSION = FusionSettings(semantic_floor=SEARCH_COSINE_FLOOR)
SEMANTIC_POOL = 2000
LEXICAL_LIMIT = 1000
MAX_RESULTS = 5000
MIN_FIRST_NAME = 3


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
    ordered = queryset.order_by(F("exif_timestamp").desc(nulls_last=True), "pk")
    return list(ordered.values_list("pk", flat=True)[:MAX_RESULTS])


def _semantic(user: User, queryset: QuerySet[Photo], parsed: ParsedQuery) -> list[UUID]:
    try:
        embedding, _ = calculate_query_embeddings(parsed.semantic_text)
    except (requests.RequestException, KeyError, ValueError) as error:
        logger.warning("semantic search unavailable, using words only: %s", error)
        return []
    pool = SEMANTIC_POOL if parsed.has_filters else user.semantic_search_topk
    scored = search_ranked_embedding(
        user.id, embedding, max(pool, user.semantic_search_topk), FUSION.semantic_floor
    )
    rows = dict(
        queryset.filter(image_hash__in=[h for h, _ in scored]).values_list(
            "image_hash", "pk"
        )
    )
    inside = [(rows[h], score) for h, score in scored if h in rows]
    if parsed.has_filters:
        return [pk for pk, _ in inside]
    kept = cut_semantic(inside, FUSION.semantic_floor)
    return kept[: user.semantic_search_topk]


def _ranked(user: User, queryset: QuerySet[Photo], parsed: ParsedQuery) -> list[UUID]:
    filtered = queryset.filter(*parsed_q(user, parsed))
    if not parsed.terms and not parsed.phrases:
        return _newest(filtered)
    lexical = list(
        lexical_matches(filtered, parsed.terms, parsed.phrases)
        .order_by(
            F("lexical_score").desc(),
            F("exif_timestamp").desc(nulls_last=True),
            "pk",
        )
        .values_list("pk", flat=True)[:LEXICAL_LIMIT]
    )
    semantic = _semantic(user, filtered, parsed) if parsed.semantic_text else []
    if parsed.phrases:
        allowed = set(lexical)
        semantic = [pk for pk in semantic if pk in allowed]
    return fuse(lexical, semantic, FUSION)[:MAX_RESULTS]


def ranked_photo_ids(
    user: User, queryset: QuerySet[Photo], text: str, language: str = ""
) -> list[UUID]:
    words = vocabulary(user, language)
    parsed = parse(text, words)
    found = _ranked(user, queryset, parsed)
    if not parsed.places:
        return found
    without_places = Vocabulary(people=words.people, translations=words.translations)
    seen = set(found)
    more = _ranked(user, queryset, parse(text, without_places))
    return [*found, *(pk for pk in more if pk not in seen)][:MAX_RESULTS]
