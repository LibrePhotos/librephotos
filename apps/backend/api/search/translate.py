from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

from api.models.photo_search import fold

THING_NAMES_FILE = Path(__file__).with_name("thing_names.json")
PLURAL_ENDINGS = ("en", "er", "es", "e", "n", "s")
MAX_PHRASE = 4


def load_lexicons(path: Path = THING_NAMES_FILE) -> dict[str, dict[str, str]]:
    names: dict[str, dict[str, str]] = json.loads(path.read_text(encoding="utf-8"))
    english = {fold(thing) for language in names.values() for thing in language}
    lexicons: dict[str, dict[str, str]] = {}
    for language, things in names.items():
        lexicon: dict[str, str] = {}
        for thing, name in sorted(things.items()):
            folded = fold(name)
            if folded not in english:
                lexicon.setdefault(folded, thing)
        lexicons[language] = lexicon
    return lexicons


LEXICONS: Mapping[str, Mapping[str, str]] = load_lexicons()


def lexicon_for(language: str) -> Mapping[str, str]:
    code = language.replace("-", "_")
    if code in LEXICONS:
        return LEXICONS[code]
    return LEXICONS.get(code.split("_")[0], {})


def _lookup(phrase: str, lexicon: Mapping[str, str]) -> str | None:
    if phrase in lexicon:
        return lexicon[phrase]
    if " " in phrase:
        return None
    for ending in PLURAL_ENDINGS:
        stem = phrase.removesuffix(ending)
        if stem != phrase and len(stem) >= 3 and stem in lexicon:
            return lexicon[stem]
    return None


def translate(
    words: Sequence[str], lexicon: Mapping[str, str]
) -> list[tuple[int, int, str]]:
    found: list[tuple[int, int, str]] = []
    i = 0
    while i < len(words):
        for width in range(min(MAX_PHRASE, len(words) - i), 0, -1):
            thing = _lookup(" ".join(words[i : i + width]), lexicon)
            if thing is not None:
                found.append((i, i + width, thing))
                i += width
                break
        else:
            i += 1
    return found
