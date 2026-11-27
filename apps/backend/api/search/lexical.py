from __future__ import annotations

import operator
import re
from collections.abc import Mapping, Sequence
from functools import reduce

from django.db.models import (
    Case,
    Exists,
    F,
    FloatField,
    OuterRef,
    Q,
    QuerySet,
    Value,
    When,
)
from django.db.models.functions import Greatest

from api.models import Face, Photo, Tag
from api.models.photo_search import fold
from api.search.semantic import OPENCLIP

FIELD_WEIGHTS: Mapping[str, float] = {
    "people": 6.0,
    "place": 5.0,
    "things": 4.0,
    "caption": 3.0,
    "ocr": 2.0,
    "other": 1.0,
}

WORD_ENDINGS = "(s|es|e|en|n|er)?"


def term_pattern(term: str) -> str:
    return rf"(^|\W){re.escape(term)}{WORD_ENDINGS}(\W|$)"


def _tagged(pattern: str) -> Q:
    links = Tag.photos.through.objects.filter(
        photo_id=OuterRef("pk"), tag__name__iregex=pattern
    )
    return Q(Exists(links))


def _named(pattern: str) -> Q:
    faces = Face.objects.filter(
        photo_id=OuterRef("pk"),
        deleted=False,
        person__name__iregex=pattern,
    )
    return Q(Exists(faces))


def field_q(term: str) -> dict[str, Q]:
    pattern = term_pattern(term)
    captions = "caption_instance__captions_json"
    return {
        "people": _named(pattern),
        "place": Q(search_instance__search_location__iregex=pattern),
        "things": Q(**{f"{captions}__{OPENCLIP}__tags__iregex": pattern})
        | _tagged(pattern),
        "caption": Q(**{f"{captions}__user_caption__iregex": pattern})
        | Q(**{f"{captions}__im2txt__iregex": pattern}),
        "ocr": Q(ocr__text__iregex=pattern),
        "other": Q(search_instance__search_folded__iregex=pattern),
    }


def candidate_q(group: Sequence[str]) -> Q:
    return reduce(
        operator.or_,
        (
            Q(search_instance__search_folded__icontains=term)
            | Q(ocr__text__icontains=term)
            | _tagged(term_pattern(term))
            for term in group
        ),
    )


def phrase_q(phrase: str) -> Q:
    return Q(search_instance__search_folded__icontains=fold(phrase)) | Q(
        ocr__text__icontains=phrase
    )


def _group_score(group: Sequence[str]) -> Greatest:
    return Greatest(
        *(
            Case(
                When(fields[name], then=Value(weight)),
                default=Value(0.0),
                output_field=FloatField(),
            )
            for fields in (field_q(term) for term in group)
            for name, weight in FIELD_WEIGHTS.items()
        ),
        output_field=FloatField(),
    )


def lexical_matches(
    queryset: QuerySet[Photo],
    groups: Sequence[Sequence[str]],
    phrases: Sequence[str] = (),
) -> QuerySet[Photo]:
    for group in groups:
        queryset = queryset.filter(candidate_q(group))
    for phrase in phrases:
        queryset = queryset.filter(phrase_q(phrase))
    if not groups:
        return queryset.annotate(lexical_score=Value(1.0, output_field=FloatField()))
    names = [f"lexical_{i}" for i in range(len(groups))]
    queryset = queryset.annotate(
        **{name: _group_score(group) for name, group in zip(names, groups, strict=True)}
    )
    queryset = queryset.filter(**{f"{name}__gt": 0 for name in names})
    total = reduce(operator.add, (F(name) for name in names))
    return queryset.annotate(lexical_score=total)
