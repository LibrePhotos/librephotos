"""The edit recipe: what a photo's edits are stored as.

A recipe is sparse JSON (a missing key is its default) and turns into a tree
of frozen dataclasses here. ``CONTROLS`` is the one table of every numeric
control's range and default: the parser below and the API serializers read it.
The parser trusts nothing: a key it does not know, a value of the wrong type or
one outside its range raises ``ValueError``.
"""

from __future__ import annotations

import dataclasses
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from _typeshed import DataclassInstance

VERSION: Final = 1


@dataclass(frozen=True)
class Control:
    """The range and default of one numeric control."""

    minimum: float
    maximum: float
    default: float
    integer: bool = False


BANDS: Final = (
    "red",
    "orange",
    "yellow",
    "green",
    "aqua",
    "blue",
    "purple",
    "magenta",
)
WHEELS: Final = ("shadows", "midtones", "highlights", "global")
CURVE_CHANNELS: Final = ("master", "red", "green", "blue")
ORIENTATIONS: Final = (0, 90, 180, 270)
ASPECTS: Final = (
    "original",
    "1:1",
    "4:5",
    "5:4",
    "5:7",
    "7:5",
    "2:3",
    "3:2",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
    "16:10",
    "10:16",
)
TREATMENTS: Final = ("color", "bw")
# A curve has 2 to 16 points, each coordinate 0 to 1.
CURVE_POINTS: Final = (2, 16)


def _controls() -> dict[str, Control]:
    signed = Control(-100, 100, 0)
    unsigned = Control(0, 100, 0)
    table = {
        "geometry.straighten": Control(-45, 45, 0),
        # A crop is null or all four; w and h must be above 0 as well.
        "geometry.crop.cx": Control(0, 1, 0.5),
        "geometry.crop.cy": Control(0, 1, 0.5),
        "geometry.crop.w": Control(0, 1, 1),
        "geometry.crop.h": Control(0, 1, 1),
        "wb.temp": signed,
        "wb.tint": signed,
        "light.exposure": Control(-5, 5, 0),
        "light.contrast": signed,
        "light.highlights": signed,
        "light.shadows": signed,
        "light.whites": signed,
        "light.blacks": signed,
        "curve.point": Control(0, 1, 0),
        "color.vibrance": signed,
        "color.saturation": signed,
        "grading.blending": Control(0, 100, 50),
        "grading.balance": signed,
        "effects.texture": signed,
        "effects.clarity": signed,
        "effects.dehaze": signed,
        "vignette.amount": signed,
        "vignette.midpoint": Control(0, 100, 50),
        "vignette.feather": Control(0, 100, 50),
        "vignette.roundness": signed,
        "grain.amount": unsigned,
        "grain.size": Control(0, 100, 25),
        "grain.roughness": Control(0, 100, 50),
        "grain.seed": Control(0, 4294967295, 0, integer=True),
        "detail.sharpen_amount": Control(0, 150, 0),
        "detail.sharpen_radius": Control(0.5, 3, 1),
        "detail.nr_luminance": unsigned,
        "detail.nr_color": unsigned,
    }
    for band in BANDS:
        for part in ("hue", "sat", "lum"):
            table[f"mixer.{band}.{part}"] = signed
        table[f"bw_mix.{band}"] = signed
    for wheel in WHEELS:
        table[f"grading.{wheel}.hue"] = Control(0, 360, 0)
        table[f"grading.{wheel}.sat"] = unsigned
        table[f"grading.{wheel}.lum"] = signed
    return table


# Every numeric control by its dotted path ("light.exposure", "mixer.red.hue").
CONTROLS: Final[dict[str, Control]] = _controls()

type Point = tuple[float, float]
type Json = None | bool | int | float | str | list[Json] | dict[str, Json]

IDENTITY_CURVE: Final[tuple[Point, ...]] = ((0.0, 0.0), (1.0, 1.0))


@dataclass(frozen=True)
class Crop:
    """A crop rectangle in the oriented picture's normalised coordinates."""

    cx: float = 0.5
    cy: float = 0.5
    w: float = 1.0
    h: float = 1.0


FULL_CROP: Final = Crop()


@dataclass(frozen=True)
class Geometry:
    orientation: int = 0
    flip_h: bool = False
    flip_v: bool = False
    straighten: float = 0.0
    crop: Crop | None = None
    aspect: str | None = None


@dataclass(frozen=True)
class WhiteBalance:
    temp: float = 0.0
    tint: float = 0.0


@dataclass(frozen=True)
class Light:
    exposure: float = 0.0
    contrast: float = 0.0
    highlights: float = 0.0
    shadows: float = 0.0
    whites: float = 0.0
    blacks: float = 0.0


@dataclass(frozen=True)
class Curve:
    master: tuple[Point, ...] = IDENTITY_CURVE
    red: tuple[Point, ...] = IDENTITY_CURVE
    green: tuple[Point, ...] = IDENTITY_CURVE
    blue: tuple[Point, ...] = IDENTITY_CURVE


@dataclass(frozen=True)
class Color:
    vibrance: float = 0.0
    saturation: float = 0.0
    treatment: str = "color"


@dataclass(frozen=True)
class Band:
    hue: float = 0.0
    sat: float = 0.0
    lum: float = 0.0


@dataclass(frozen=True)
class Mixer:
    red: Band = Band()
    orange: Band = Band()
    yellow: Band = Band()
    green: Band = Band()
    aqua: Band = Band()
    blue: Band = Band()
    purple: Band = Band()
    magenta: Band = Band()


@dataclass(frozen=True)
class BwMix:
    red: float = 0.0
    orange: float = 0.0
    yellow: float = 0.0
    green: float = 0.0
    aqua: float = 0.0
    blue: float = 0.0
    purple: float = 0.0
    magenta: float = 0.0


@dataclass(frozen=True)
class Wheel:
    hue: float = 0.0
    sat: float = 0.0
    lum: float = 0.0


@dataclass(frozen=True)
class Grading:
    shadows: Wheel = Wheel()
    midtones: Wheel = Wheel()
    highlights: Wheel = Wheel()
    # "global" in JSON, a keyword in Python.
    global_: Wheel = field(default=Wheel(), metadata={"key": "global"})
    blending: float = 50.0
    balance: float = 0.0


@dataclass(frozen=True)
class Effects:
    texture: float = 0.0
    clarity: float = 0.0
    dehaze: float = 0.0


@dataclass(frozen=True)
class Vignette:
    amount: float = 0.0
    midpoint: float = 50.0
    feather: float = 50.0
    roundness: float = 0.0


@dataclass(frozen=True)
class Grain:
    amount: float = 0.0
    size: float = 25.0
    roughness: float = 50.0
    seed: int = 0


@dataclass(frozen=True)
class Detail:
    sharpen_amount: float = 0.0
    sharpen_radius: float = 1.0
    nr_luminance: float = 0.0
    nr_color: float = 0.0


@dataclass(frozen=True)
class Recipe:
    geometry: Geometry = Geometry()
    wb: WhiteBalance = WhiteBalance()
    light: Light = Light()
    curve: Curve = Curve()
    color: Color = Color()
    mixer: Mixer = Mixer()
    bw_mix: BwMix = BwMix()
    grading: Grading = Grading()
    effects: Effects = Effects()
    vignette: Vignette = Vignette()
    grain: Grain = Grain()
    detail: Detail = Detail()


DEFAULT_RECIPE: Final = Recipe()


# --- JSON to Recipe ----------------------------------------------------------


def _key(f: dataclasses.Field[object]) -> str:
    key = f.metadata.get("key", f.name)
    return str(key)


def _number(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{path}: expected a number")
    try:
        number = float(value)
    except OverflowError:
        # An integer too large for a float: JSON allows any number of digits.
        raise ValueError(f"{path}: expected a finite number") from None
    if not math.isfinite(number):
        raise ValueError(f"{path}: expected a finite number")
    return number


def _control(value: object, path: str) -> float:
    control = CONTROLS[path]
    number = _number(value, path)
    if control.integer and not (isinstance(value, int) and number.is_integer()):
        raise ValueError(f"{path}: expected an integer")
    if not control.minimum <= number <= control.maximum:
        raise ValueError(
            f"{path}: {number} is outside {control.minimum} to {control.maximum}"
        )
    return number


def _object(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
        raise ValueError(f"{path}: expected an object")
    return {str(k): v for k, v in value.items()}


def _crop(value: object) -> Crop | None:
    if value is None:
        return None
    data = _object(value, "geometry.crop")
    if set(data) != {"cx", "cy", "w", "h"}:
        raise ValueError("geometry.crop: expected exactly cx, cy, w and h")
    crop = Crop(
        cx=_control(data["cx"], "geometry.crop.cx"),
        cy=_control(data["cy"], "geometry.crop.cy"),
        w=_control(data["w"], "geometry.crop.w"),
        h=_control(data["h"], "geometry.crop.h"),
    )
    if crop.w <= 0 or crop.h <= 0:
        raise ValueError("geometry.crop: w and h must be above 0")
    return crop


def _curve_points(value: object, path: str) -> tuple[Point, ...]:
    low, high = CURVE_POINTS
    if not isinstance(value, list) or not low <= len(value) <= high:
        raise ValueError(f"{path}: expected {low} to {high} points")
    points: list[Point] = []
    for index, point in enumerate(value):
        if not isinstance(point, list | tuple) or len(point) != 2:
            raise ValueError(f"{path}[{index}]: expected [x, y]")
        x = _control(point[0], "curve.point")
        y = _control(point[1], "curve.point")
        if points and x <= points[-1][0]:
            raise ValueError(f"{path}: x must be strictly increasing")
        points.append((x, y))
    return tuple(points)


def _choice[T](value: object, choices: tuple[T, ...], path: str) -> T:
    for choice in choices:
        if value == choice and type(value) is type(choice):
            return choice
    raise ValueError(f"{path}: expected one of {', '.join(map(str, choices))}")


def _flag(value: object, path: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{path}: expected a boolean")
    return value


def _aspect(value: object, path: str) -> str | None:
    return None if value is None else _choice(value, ASPECTS, path)


def _seed(value: object, path: str) -> int:
    return int(_control(value, path))


# Parsers of the leaves that are not plain numeric controls.
_SPECIAL: Final[dict[str, Callable[[object, str], object]]] = {
    "geometry.orientation": lambda value, path: _choice(value, ORIENTATIONS, path),
    "geometry.flip_h": _flag,
    "geometry.flip_v": _flag,
    "geometry.crop": lambda value, path: _crop(value),
    "geometry.aspect": _aspect,
    "color.treatment": lambda value, path: _choice(value, TREATMENTS, path),
    "grain.seed": _seed,
    **{f"curve.{channel}": _curve_points for channel in CURVE_CHANNELS},
}


def _special(path: str, value: object) -> object:
    parser = _SPECIAL.get(path)
    if parser is None:
        raise ValueError(f"{path}: unknown control")
    return parser(value, path)


def _parse_group[G: DataclassInstance](default: G, value: object, path: str) -> G:
    data = _object(value, path)
    fields_by_key = {_key(f): f for f in dataclasses.fields(default)}
    unknown = set(data) - set(fields_by_key)
    if unknown:
        raise ValueError(f"{path}: unknown keys {', '.join(sorted(unknown))}")
    changes: dict[str, object] = {}
    for key, raw in data.items():
        f = fields_by_key[key]
        child = getattr(default, f.name)
        child_path = f"{path}.{key}"
        if dataclasses.is_dataclass(child) and not isinstance(child, type):
            changes[f.name] = _parse_group(child, raw, child_path)
        elif isinstance(child, float) and child_path in CONTROLS:
            changes[f.name] = _control(raw, child_path)
        else:
            changes[f.name] = _special(child_path, raw)
    return dataclasses.replace(default, **changes)


def recipe_from_json(data: object) -> Recipe:
    """The recipe a sparse JSON object describes; ``ValueError`` if it is invalid."""
    body = _object(data, "recipe")
    version = body.pop("version", VERSION)
    if version != VERSION or isinstance(version, bool):
        raise ValueError(f"version: expected {VERSION}")
    recipe = DEFAULT_RECIPE
    for f in dataclasses.fields(Recipe):
        if f.name in body:
            group = _parse_group(getattr(recipe, f.name), body.pop(f.name), f.name)
            recipe = dataclasses.replace(recipe, **{f.name: group})
    if body:
        raise ValueError(f"recipe: unknown keys {', '.join(sorted(body))}")
    return recipe


# --- Recipe to JSON ----------------------------------------------------------


def _leaf_json(value: object) -> Json:
    if isinstance(value, Crop):
        return {"cx": value.cx, "cy": value.cy, "w": value.w, "h": value.h}
    if isinstance(value, tuple):
        return [[x, y] for x, y in value]
    if value is None or isinstance(value, bool | int | float | str):
        return value
    raise TypeError(f"cannot write {type(value).__name__}")


def _group_json(group: DataclassInstance, default: object) -> dict[str, Json]:
    out: dict[str, Json] = {}
    for f in dataclasses.fields(group):
        value = getattr(group, f.name)
        default_value = getattr(default, f.name)
        if value == default_value:
            continue
        if dataclasses.is_dataclass(value) and dataclasses.is_dataclass(default_value):
            if isinstance(value, type):
                raise TypeError(f"{f.name}: expected an instance")
            out[_key(f)] = _group_json(value, default_value)
        else:
            out[_key(f)] = _leaf_json(value)
    return out


def recipe_to_json(recipe: Recipe) -> dict[str, Json]:
    """The sparse JSON of ``recipe``: ``version`` and its non-default values."""
    out: dict[str, Json] = {"version": VERSION}
    out.update(_group_json(recipe, DEFAULT_RECIPE))
    return out


# --- What a recipe does ------------------------------------------------------


def changes_geometry(recipe: Recipe) -> bool:
    """Whether the edited picture is framed differently from the source."""
    geometry = recipe.geometry
    return (
        geometry.orientation != 0
        or geometry.flip_h
        or geometry.flip_v
        or geometry.straighten != 0
        or (geometry.crop is not None and geometry.crop != FULL_CROP)
    )


def curve_is_identity(points: tuple[Point, ...]) -> bool:
    """A curve through points on the diagonal, from 0 to 1, changes nothing."""
    return (
        points[0][0] == 0.0 and points[-1][0] == 1.0 and all(x == y for x, y in points)
    )


def light_table_active(light: Light) -> bool:
    return light.contrast != 0 or light.whites != 0 or light.blacks != 0


def curve_active(curve: Curve) -> bool:
    return not all(
        curve_is_identity(getattr(curve, channel)) for channel in CURVE_CHANNELS
    )


def colour_active(recipe: Recipe) -> bool:
    """Whether stage 4.7 runs (the doc's skip condition, negated)."""
    return (
        recipe.color.vibrance != 0
        or recipe.color.saturation != 0
        or recipe.color.treatment != "color"
        or recipe.mixer != Mixer()
        or recipe.bw_mix != BwMix()
        or recipe.grading != Grading()
    )


def is_identity(recipe: Recipe) -> bool:
    """Whether rendering ``recipe`` on an sRGB picture gives the picture back.

    Controls that only matter when another one is set (Grain size without
    Grain, the Vignette midpoint without an amount) and the aspect lock do
    not count.
    """
    return not (
        changes_geometry(recipe)
        or recipe.wb != WhiteBalance()
        or recipe.light != Light()
        or curve_active(recipe.curve)
        or colour_active(recipe)
        or recipe.effects != Effects()
        or recipe.vignette.amount != 0
        or recipe.grain.amount != 0
        or recipe.detail.sharpen_amount != 0
        or recipe.detail.nr_luminance != 0
        or recipe.detail.nr_color != 0
    )
