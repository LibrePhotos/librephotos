"""Write a compose .env from an upstream template, changing only the named keys.

    python3 -m teardown_bench.envfile TEMPLATE OUT KEY=VALUE [KEY=VALUE ...]

Every other line of the upstream file stays as shipped, so the run uses the
project's defaults; the keys passed here (paths, version pin, admin login) are
the ones the upstream install guide tells a user to edit.
"""

from __future__ import annotations

import sys
from pathlib import Path


def render(template: str, changes: dict[str, str]) -> str:
    lines, seen = [], set()
    for line in template.splitlines():
        key = line.split("=", 1)[0].strip()
        if "=" in line and not line.lstrip().startswith("#") and key in changes:
            lines.append(f"{key}={changes[key]}")
            seen.add(key)
        else:
            lines.append(line)
    missing = [k for k in changes if k not in seen]
    if missing:
        lines.append("")
        lines.append("# Added by the teardown benchmark (benchmarks/teardown/bench/run_tool.sh)")
        lines.extend(f"{key}={changes[key]}" for key in missing)
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    template, out, *pairs = argv
    changes = dict(pair.split("=", 1) for pair in pairs)
    Path(out).write_text(render(Path(template).read_text(encoding="utf-8"), changes), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
