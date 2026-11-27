import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
LOCALES = BACKEND.parent / "frontend" / "src" / "locales"
TARGET = BACKEND / "api" / "search" / "thing_names.json"


def collect(locales: Path) -> dict[str, dict[str, str]]:
    english = json.loads((locales / "en" / "tags.json").read_text(encoding="utf-8"))
    names: dict[str, dict[str, str]] = {}
    for path in sorted(locales.glob("*/tags.json")):
        language = path.parent.name
        if language == "en":
            continue
        translated = json.loads(path.read_text(encoding="utf-8"))
        names[language] = {
            thing: name
            for thing, name in sorted(translated.items())
            if thing in english and isinstance(name, str) and name.strip()
        }
    return names


def render(names: dict[str, dict[str, str]]) -> str:
    return json.dumps(names, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def main() -> int:
    text = render(collect(LOCALES))
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != text:
            sys.stdout.write(f"{TARGET} is stale: run scripts/sync_thing_names.py\n")
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
