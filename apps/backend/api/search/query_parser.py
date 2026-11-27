from __future__ import annotations

import datetime
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from api.models.photo_search import fold
from api.search.translate import translate

MAX_SPAN = 4
MIN_PLACE_PART = 6

MONTHS: Mapping[str, int] = {
    "january": 1,
    "jan": 1,
    "januar": 1,
    "janner": 1,
    "february": 2,
    "feb": 2,
    "februar": 2,
    "march": 3,
    "mar": 3,
    "marz": 3,
    "maerz": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "mai": 5,
    "june": 6,
    "jun": 6,
    "juni": 6,
    "july": 7,
    "jul": 7,
    "juli": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "oktober": 10,
    "okt": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
    "dezember": 12,
    "dez": 12,
}

SEASONS: Mapping[str, tuple[int, ...]] = {
    "spring": (3, 4, 5),
    "fruhling": (3, 4, 5),
    "fruehling": (3, 4, 5),
    "fruhjahr": (3, 4, 5),
    "summer": (6, 7, 8),
    "sommer": (6, 7, 8),
    "autumn": (9, 10, 11),
    "fall": (9, 10, 11),
    "herbst": (9, 10, 11),
    "winter": (12, 1, 2),
}

RELATIVE_YEARS: Mapping[tuple[str, ...], int] = {
    ("this", "year"): 0,
    ("dieses", "jahr"): 0,
    ("last", "year"): -1,
    ("letztes", "jahr"): -1,
    ("letzten", "jahr"): -1,
    ("vorjahr",): -1,
}

CONNECTORS = frozenset(
    {
        "in",
        "at",
        "on",
        "from",
        "of",
        "during",
        "near",
        "around",
        "taken",
        "im",
        "am",
        "an",
        "auf",
        "aus",
        "von",
        "vom",
        "bei",
        "beim",
        "wahrend",
        "zu",
        "zur",
        "zum",
    }
)

STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "with",
        "of",
        "in",
        "at",
        "on",
        "to",
        "for",
        "my",
        "our",
        "photo",
        "photos",
        "picture",
        "pictures",
        "pic",
        "pics",
        "image",
        "images",
        "ein",
        "eine",
        "einer",
        "einem",
        "einen",
        "der",
        "die",
        "das",
        "den",
        "dem",
        "des",
        "und",
        "oder",
        "mit",
        "im",
        "am",
        "auf",
        "fur",
        "mein",
        "meine",
        "unser",
        "foto",
        "fotos",
        "bild",
        "bilder",
    }
)

FOREIGN_STOPWORDS = frozenset(
    {
        "ein",
        "eine",
        "einer",
        "einem",
        "einen",
        "der",
        "die",
        "das",
        "den",
        "dem",
        "des",
        "und",
        "oder",
        "mit",
        "im",
        "am",
        "auf",
        "bei",
        "beim",
        "von",
        "vom",
        "fur",
        "zu",
        "zum",
        "zur",
    }
)

AMBIGUOUS_MONTHS = frozenset(
    {
        "jan",
        "feb",
        "mar",
        "march",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "sept",
        "oct",
        "okt",
        "nov",
        "dec",
        "dez",
        "fall",
    }
)

_WORD = re.compile(r"\w+", re.UNICODE)
_QUOTED = re.compile(r'"([^"]+)"')
_YEAR = re.compile(r"(19|20)\d\d")


@dataclass(frozen=True)
class DateSpec:
    years: tuple[int, ...] = ()
    months: tuple[int, ...] = ()


@dataclass(frozen=True)
class Vocabulary:
    people: Mapping[str, int] = field(default_factory=dict)
    places: Sequence[str] = ()
    translations: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ParsedQuery:
    text: str
    terms: tuple[tuple[str, ...], ...]
    semantic_text: str = ""
    phrases: tuple[str, ...] = ()
    dates: tuple[DateSpec, ...] = ()
    people: tuple[int, ...] = ()
    places: tuple[str, ...] = ()

    @property
    def has_filters(self) -> bool:
        return bool(self.dates or self.people or self.places)


@dataclass(frozen=True)
class _Token:
    raw: str
    folded: str


@dataclass(frozen=True)
class _Match:
    start: int
    end: int
    kind: str
    value: object


def tokenize(text: str) -> list[str]:
    return _WORD.findall(text)


def _tokens(text: str) -> list[_Token]:
    return [_Token(raw, fold(raw)) for raw in tokenize(text)]


def _year(token: _Token) -> int | None:
    if _YEAR.fullmatch(token.folded):
        return int(token.folded)
    return None


def _date_at(tokens: Sequence[_Token], i: int, today: datetime.date) -> _Match | None:
    word = tokens[i].folded
    for words, offset in RELATIVE_YEARS.items():
        span = tuple(t.folded for t in tokens[i : i + len(words)])
        if span == words:
            return _Match(i, i + len(words), "date", DateSpec((today.year + offset,)))
    months: tuple[int, ...] = ()
    if word in MONTHS:
        months = (MONTHS[word],)
    elif word in SEASONS:
        months = SEASONS[word]
    if months:
        if i + 1 < len(tokens) and (year := _year(tokens[i + 1])) is not None:
            return _Match(i, i + 2, "date", DateSpec((year,), months))
        if word in AMBIGUOUS_MONTHS:
            return None
        return _Match(i, i + 1, "date", DateSpec((), months))
    year = _year(tokens[i])
    if year is not None:
        return _Match(i, i + 1, "date", DateSpec((year,)))
    return None


def _people_at(
    tokens: Sequence[_Token], i: int, people: Mapping[str, int]
) -> _Match | None:
    for width in range(min(MAX_SPAN, len(tokens) - i), 0, -1):
        span = " ".join(t.folded for t in tokens[i : i + width])
        if span in people:
            return _Match(i, i + width, "person", people[span])
    return None


def _place_words(place: str) -> list[str]:
    return [fold(word) for word in tokenize(place)]


def _place_at(
    tokens: Sequence[_Token], i: int, places: Sequence[tuple[str, list[str]]]
) -> _Match | None:
    for width in range(min(MAX_SPAN, len(tokens) - i), 0, -1):
        span = [t.folded for t in tokens[i : i + width]]
        partial_ok = len("".join(span)) >= MIN_PLACE_PART
        for place, words in places:
            whole = words == span
            inside = partial_ok and any(
                words[start : start + width] == span
                for start in range(len(words) - width + 1)
            )
            if whole or inside:
                return _Match(i, i + width, "place", place)
    return None


def _matches(
    tokens: Sequence[_Token],
    vocabulary: Vocabulary,
    today: datetime.date,
) -> list[_Match]:
    people = {fold(name): pid for name, pid in vocabulary.people.items()}
    places = [(place, _place_words(place)) for place in vocabulary.places]
    found: list[_Match] = []
    i = 0
    while i < len(tokens):
        match = (
            _people_at(tokens, i, people)
            or _date_at(tokens, i, today)
            or _place_at(tokens, i, places)
        )
        if match is None:
            i += 1
            continue
        found.append(match)
        i = match.end
    return found


def _residual(tokens: Sequence[_Token], matches: Sequence[_Match]) -> list[_Token]:
    taken = {i for m in matches for i in range(m.start, m.end)}
    kept = [t for i, t in enumerate(tokens) if i not in taken]
    if not matches:
        return kept
    left = [i for i, t in enumerate(tokens) if i not in taken]
    edges = {m.start - 1 for m in matches} | {m.end for m in matches}
    return [
        tokens[i] for i in left if not (i in edges and tokens[i].folded in CONNECTORS)
    ]


def _merge_dates(specs: Iterable[DateSpec]) -> tuple[DateSpec, ...]:
    specs = list(specs)
    years = tuple(y for s in specs for y in s.years)
    months = tuple(m for s in specs for m in s.months)
    if not specs:
        return ()
    return (DateSpec(years, months),)


def _translated(
    residual: Sequence[_Token], translations: Mapping[str, str]
) -> tuple[tuple[tuple[str, ...], ...], str]:
    spans = translate([t.folded for t in residual], translations)
    thing_at = {i: thing for start, end, thing in spans for i in range(start, end)}
    groups = [
        tuple(dict.fromkeys(a for a in (t.folded, fold(thing_at.get(i, ""))) if a))
        for i, t in enumerate(residual)
        if t.folded and t.folded not in STOPWORDS
    ]
    words: list[str] = []
    starts = {start: thing for start, _, thing in spans}
    for i, token in enumerate(residual):
        if i in starts:
            words.append(starts[i])
        elif i not in thing_at and not (spans and token.folded in FOREIGN_STOPWORDS):
            words.append(token.raw)
    return tuple(dict.fromkeys(groups)), " ".join(words)


def parse(
    text: str, vocabulary: Vocabulary, today: datetime.date | None = None
) -> ParsedQuery:
    today = today or datetime.date.today()
    phrases = tuple(p.strip() for p in _QUOTED.findall(text) if p.strip())
    rest = _QUOTED.sub(" ", text)
    tokens = _tokens(rest)
    matches = _matches(tokens, vocabulary, today)
    residual = _residual(tokens, matches)
    terms, semantic_text = _translated(residual, vocabulary.translations)
    return ParsedQuery(
        text=" ".join(t.raw for t in residual),
        terms=terms,
        semantic_text=semantic_text,
        phrases=phrases,
        dates=_merge_dates(m.value for m in matches if isinstance(m.value, DateSpec)),
        people=tuple(
            dict.fromkeys(
                m.value
                for m in matches
                if m.kind == "person" and isinstance(m.value, int)
            )
        ),
        places=tuple(dict.fromkeys(str(m.value) for m in matches if m.kind == "place")),
    )
