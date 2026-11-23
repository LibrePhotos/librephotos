"""The golden values both renderers are checked against: ``testdata/goldens.json``.

``python -m api.editing.goldens --write`` regenerates the file after a formula
changes (the backend suite fails while it is stale). The layout is described
under "Golden file" in ``apps/docs/docs/development/photo-editing.md``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Final

from api.editing import tables
from api.editing.geometry import round_half_up
from api.editing.pipeline import (
    PixelPlanes,
    develop,
    develop_params,
    grain,
    grain_noise,
    vignette,
)
from api.editing.recipe import (
    BANDS,
    CONTROLS,
    WHEELS,
    Json,
    Recipe,
    curve_active,
    light_table_active,
    recipe_from_json,
    recipe_to_json,
)
from api.lazy_import import LazyModule

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt
else:
    np = LazyModule("numpy")

GOLDEN_PATH: Final = Path(__file__).parent / "testdata" / "goldens.json"
FORMAT: Final = 1
SOURCE_MAXES: Final = (1.0, 1.4)
TABLE_SAMPLES: Final = 65
HUE_STEP: Final = 5
# Finish cases are rendered at these output sizes (landscape and portrait).
FINISH_SIZES: Final = ((3000, 2000), (1000, 1500))


def _r(value: float) -> float:
    """Six decimals, without a negative zero."""
    return round(float(value), 6) + 0.0


def _rs(values: npt.NDArray[np.floating]) -> Json:
    if values.ndim == 1:
        return [_r(v) for v in values]
    return [_rs(row) for row in values]


def _table_indices() -> list[int]:
    return [
        round_half_up(i * (tables.TABLE_SIZE - 1) / (TABLE_SAMPLES - 1))
        for i in range(TABLE_SAMPLES)
    ]


def _pixel_inputs(source_max: float) -> list[dict[str, Json]]:
    """Linear colours with the plane values each one is developed with."""
    colours = [
        (0.0, 0.0, 0.0),
        (0.002, 0.003, 0.004),
        (0.05, 0.04, 0.03),
        (0.18, 0.18, 0.18),
        (0.45, 0.25, 0.15),
        (0.6, 0.08, 0.05),
        (0.05, 0.25, 0.7),
        (0.1, 0.5, 0.12),
        (0.9, 0.85, 0.7),
        # A channel at the clip level M of the default recipe, and one just below.
        (source_max, 0.95 * source_max, 0.9 * source_max),
        (0.97 * source_max, 0.9 * source_max, 0.8 * source_max),
    ]
    lc_offsets = (-0.8, 0.5, 0.0, 1.2, -1.5, 0.3, -0.4, 0.9, -0.2, 0.6, 0.1)
    lf_offsets = (0.3, -0.6, 0.2, -0.1, 0.7, -0.9, 0.4, -0.3, 0.1, -0.5, 0.2)
    inputs: list[dict[str, Json]] = []
    for colour, lc_offset, lf_offset in zip(
        colours, lc_offsets, lf_offsets, strict=True
    ):
        r, g, b = colour
        ly = float(
            np.log2(
                max(tables.LUMA[0] * r + tables.LUMA[1] * g + tables.LUMA[2] * b, 1e-4)
            )
        )
        dk = min(max(min(colour), 0.0), 1.0) * 0.7 + 0.05
        inputs.append(
            {
                "rgb": [_r(r), _r(g), _r(b)],
                "lc": _r(ly + lc_offset),
                "lf": _r(ly + lf_offset),
                "dk": _r(dk),
            }
        )
    return inputs


def _extremes(path: str) -> list[tuple[str, Json]]:
    control = CONTROLS[path]
    return [
        (f"{path}={control.minimum:g}", control.minimum),
        (f"{path}={control.maximum:g}", control.maximum),
    ]


def _nest(path: str, value: Json) -> dict[str, Json]:
    group, *rest = path.split(".")
    if not rest:
        return {group: value}
    return {group: _nest(".".join(rest), value)}


def _stage4_recipes() -> list[tuple[str, dict[str, Json]]]:
    """Named sparse recipes covering every control that stage 4 reads."""
    cases: list[tuple[str, dict[str, Json]]] = [("default", {})]
    for path in (
        "wb.temp",
        "wb.tint",
        "light.exposure",
        "light.contrast",
        "light.highlights",
        "light.shadows",
        "light.whites",
        "light.blacks",
        "color.vibrance",
        "color.saturation",
        "effects.texture",
        "effects.clarity",
        "effects.dehaze",
    ):
        for name, value in _extremes(path):
            cases.append((name, _nest(path, value)))
    cases += [
        ("light.exposure=0.35", {"light": {"exposure": 0.35}}),
        (
            "light.exposure=1,highlights=-100",
            {"light": {"exposure": 1, "highlights": -100}},
        ),
        (
            "light.highlights=-60,shadows=45",
            {"light": {"highlights": -60, "shadows": 45}},
        ),
        (
            "effects.clarity=40,texture=-30",
            {"effects": {"clarity": 40, "texture": -30}},
        ),
        ("color.treatment=bw", {"color": {"treatment": "bw"}}),
    ]
    spread = (-100, -70, -35, -10, 15, 40, 75, 100)
    for part in ("hue", "sat", "lum"):
        cases.append(
            (
                f"mixer.*.{part}",
                {
                    "mixer": {
                        band: {part: v} for band, v in zip(BANDS, spread, strict=True)
                    }
                },
            )
        )
    for value in (-100, 100):
        cases.append(
            (
                f"mixer.*={value}",
                {
                    "mixer": {
                        band: {"hue": value, "sat": value, "lum": value}
                        for band in BANDS
                    }
                },
            )
        )
    cases.append(
        (
            "bw_mix.*",
            {
                "color": {"treatment": "bw"},
                "bw_mix": dict(zip(BANDS, spread, strict=True)),
            },
        )
    )
    for value in (-100, 100):
        cases.append(
            (
                f"bw_mix.*={value}",
                {"color": {"treatment": "bw"}, "bw_mix": dict.fromkeys(BANDS, value)},
            )
        )
    wheel_settings: dict[str, Json] = {
        "shadows": {"hue": 220, "sat": 60, "lum": -30},
        "midtones": {"hue": 40, "sat": 35, "lum": 20},
        "highlights": {"hue": 60, "sat": 80, "lum": 50},
        "global": {"hue": 300, "sat": 25, "lum": -15},
    }
    for wheel in WHEELS:
        cases.append((f"grading.{wheel}", {"grading": {wheel: wheel_settings[wheel]}}))
    cases += [
        (
            "grading.extreme",
            {"grading": {w: {"hue": 360, "sat": 100, "lum": 100} for w in WHEELS}},
        ),
        (
            "grading.extreme_low",
            {"grading": {w: {"hue": 0, "sat": 100, "lum": -100} for w in WHEELS}},
        ),
    ]
    for path in ("grading.blending", "grading.balance"):
        for name, value in _extremes(path):
            nested = _nest(path, value)
            grading = nested["grading"]
            assert isinstance(grading, dict)
            grading.update(
                {
                    "shadows": wheel_settings["shadows"],
                    "highlights": wheel_settings["highlights"],
                }
            )
            cases.append((name, nested))
    s_curve: Json = [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]]
    cases += [
        ("curve.master", {"curve": {"master": s_curve}}),
        ("curve.red", {"curve": {"red": [[0, 0.1], [0.5, 0.6], [1, 0.95]]}}),
        ("curve.green", {"curve": {"green": [[0, 0], [0.4, 0.3], [1, 1]]}}),
        ("curve.blue", {"curve": {"blue": [[0.1, 0], [0.9, 1]]}}),
        (
            "curve.many_points",
            {
                "curve": {
                    "master": [[i / 15, (i / 15) ** 0.8] for i in range(16)],
                }
            },
        ),
        (
            "curve.not_monotone",
            {
                "curve": {
                    "master": [[0, 0.1], [0.3, 0.7], [0.5, 0.2], [0.8, 0.9], [1, 0.4]]
                }
            },
        ),
    ]
    cases += [
        (
            "look.warm_film",
            {
                "wb": {"temp": 25, "tint": 8},
                "light": {
                    "exposure": 0.2,
                    "contrast": 25,
                    "highlights": -40,
                    "shadows": 30,
                    "blacks": -15,
                },
                "curve": {"master": s_curve},
                "color": {"vibrance": 30, "saturation": -10},
                "grading": {
                    "shadows": {"hue": 200, "sat": 20},
                    "highlights": {"hue": 45, "sat": 25},
                },
            },
        ),
        (
            "look.moody_bw",
            {
                "light": {
                    "exposure": -0.3,
                    "contrast": 60,
                    "whites": 20,
                    "blacks": -40,
                },
                "color": {"treatment": "bw"},
                "bw_mix": {"red": 40, "orange": 30, "blue": -50},
                "effects": {"clarity": 35, "dehaze": 20},
                "grading": {"global": {"hue": 35, "sat": 15}},
            },
        ),
        (
            "look.faded",
            {
                "light": {"contrast": -40, "blacks": 60, "highlights": -20},
                "curve": {"master": [[0, 0.12], [0.5, 0.5], [1, 0.92]]},
                "color": {"saturation": -35},
                "effects": {"dehaze": -30, "texture": 20},
            },
        ),
        (
            "look.punchy",
            {
                "wb": {"temp": -15, "tint": -20},
                "light": {"exposure": 0.6, "contrast": 45, "shadows": 60, "whites": 35},
                "color": {"vibrance": 70, "saturation": 15},
                "mixer": {"blue": {"sat": 40, "lum": -30}, "green": {"hue": -40}},
                "effects": {"clarity": 50, "texture": 40, "dehaze": 45},
            },
        ),
    ]
    return cases


def _stage4_case(name: str, sparse: dict[str, Json]) -> dict[str, Json]:
    recipe = recipe_from_json(sparse)
    indices = _table_indices()
    case: dict[str, Json] = {
        "name": name,
        "recipe": recipe_to_json(recipe),
        "light": _rs(tables.light_table(recipe.light)[indices])
        if light_table_active(recipe.light)
        else None,
        "curve": _rs(tables.curve_table(recipe.curve)[indices])
        if curve_active(recipe.curve)
        else None,
        "hue": _rs(tables.hue_table(recipe)[::HUE_STEP])
        if recipe.mixer != Recipe().mixer or recipe.bw_mix != Recipe().bw_mix
        else None,
    }
    runs: list[Json] = []
    for source_max in SOURCE_MAXES:
        inputs = _pixel_inputs(source_max)
        rgb = np.array([p["rgb"] for p in inputs], dtype=np.float64)
        planes = PixelPlanes(
            lc=np.array([p["lc"] for p in inputs], dtype=np.float64),
            lf=np.array([p["lf"] for p in inputs], dtype=np.float64),
            dk=np.array([p["dk"] for p in inputs], dtype=np.float64),
        )
        params = develop_params(recipe, source_max)
        wb = params.wb
        runs.append(
            {
                "source_max": source_max,
                "wb": {
                    "k": [_r(k) for k in wb.k],
                    "gain": _r(wb.gain),
                    "M": _r(wb.ceiling),
                },
                "e": _rs(develop(rgb.T, planes, params).T),
            }
        )
    case["runs"] = runs
    return case


def _finish_points() -> list[dict[str, Json]]:
    """Normalised positions with a display-encoded colour each."""
    points: list[dict[str, Json]] = []
    for index in range(12):
        u = (index * 0.37 + 0.05) % 1
        v = (index * 0.61 + 0.11) % 1
        level = 0.1 + 0.8 * ((index * 0.29) % 1)
        e = [level, (level * 0.8 + 0.1) % 1, (level * 0.6 + 0.3) % 1]
        points.append({"uv": [_r(u), _r(v)], "e": [_r(c) for c in e]})
    return points


def _finish_recipes() -> list[tuple[str, dict[str, Json]]]:
    cases: list[tuple[str, dict[str, Json]]] = []
    for amount in (-100, -40, 60, 100):
        cases.append((f"vignette.amount={amount}", {"vignette": {"amount": amount}}))
    for path in ("vignette.midpoint", "vignette.feather", "vignette.roundness"):
        for name, value in _extremes(path):
            nested = _nest(path, value)
            vignette_group = nested["vignette"]
            assert isinstance(vignette_group, dict)
            vignette_group["amount"] = -70
            cases.append((name, nested))
    cases.append(("grain.amount=100", {"grain": {"amount": 100}}))
    for path in ("grain.size", "grain.roughness", "grain.seed"):
        for name, value in _extremes(path):
            nested = _nest(path, value)
            grain_group = nested["grain"]
            assert isinstance(grain_group, dict)
            grain_group["amount"] = 80
            cases.append((name, nested))
    cases.append(("grain.seed=12345", {"grain": {"amount": 50, "seed": 12345}}))
    cases.append(
        (
            "vignette+grain",
            {
                "vignette": {"amount": -50, "roundness": 30},
                "grain": {"amount": 40, "size": 60, "seed": 7},
            },
        )
    )
    return cases


def _finish_case(name: str, sparse: dict[str, Json]) -> dict[str, Json]:
    recipe = recipe_from_json(sparse)
    points = _finish_points()
    uv = np.array([p["uv"] for p in points], dtype=np.float64)
    e_in = np.array([p["e"] for p in points], dtype=np.float64).T
    runs: list[Json] = []
    for width, height in FINISH_SIZES:
        e: npt.NDArray[np.floating] = e_in
        if recipe.vignette.amount:
            e = vignette(e, (uv[:, 0], uv[:, 1]), (width, height), recipe.vignette)
        if recipe.grain.amount:
            noise = grain_noise(uv[:, 0], uv[:, 1], width, height, recipe.grain)
            e = grain(e, noise, recipe.grain)
        runs.append({"width": width, "height": height, "e": _rs(e.T)})
    return {"name": name, "recipe": recipe_to_json(recipe), "runs": runs}


def generate() -> dict[str, Json]:
    """The golden values, freshly computed."""
    return {
        "format": FORMAT,
        "table_indices": list(_table_indices()),
        "hue_degrees": list(range(0, 360, HUE_STEP)),
        "pixel_inputs": [
            {"source_max": m, "pixels": list(_pixel_inputs(m))} for m in SOURCE_MAXES
        ],
        "cases": [_stage4_case(name, sparse) for name, sparse in _stage4_recipes()],
        "finish_points": list(_finish_points()),
        "finish_cases": [
            _finish_case(name, sparse) for name, sparse in _finish_recipes()
        ],
    }


def _compact(value: Json) -> str:
    return json.dumps(value, separators=(",", ":"))


def golden_text(data: dict[str, Json]) -> str:
    """``data`` as the committed file: one case per line."""
    lines = ["{"]
    keys = list(data)
    for index, key in enumerate(keys):
        value = data[key]
        comma = "," if index < len(keys) - 1 else ""
        if isinstance(value, list) and value and isinstance(value[0], dict):
            lines.append(f"  {json.dumps(key)}: [")
            for item_index, item in enumerate(value):
                item_comma = "," if item_index < len(value) - 1 else ""
                lines.append(f"    {_compact(item)}{item_comma}")
            lines.append(f"  ]{comma}")
        else:
            lines.append(f"  {json.dumps(key)}: {_compact(value)}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="rewrite the golden file")
    args = parser.parse_args(argv)
    text = golden_text(generate())
    if args.write:
        GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN_PATH.write_text(text, encoding="utf-8", newline="\n")
        return 0
    if not GOLDEN_PATH.exists() or GOLDEN_PATH.read_text(encoding="utf-8") != text:
        sys.stderr.write(f"{GOLDEN_PATH} is stale; run with --write\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
