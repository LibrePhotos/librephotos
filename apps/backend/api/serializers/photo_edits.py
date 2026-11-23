"""A photo's edit: the recipe, the history and the rendition, as the API sends them.

The JSON shapes are those of ``apps/docs/docs/development/photo-editing.md``.
The recipe serializers below only describe the recipe for the OpenAPI schema
(named components, bounds read from ``api.editing.recipe.CONTROLS``); the
recipe parser (``recipe_from_json``) is what accepts or refuses one, so a
recipe and its history steps travel as the JSON they are.
"""

from __future__ import annotations

import datetime
import json
import math
import re
from typing import Any, Final, TypedDict

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.drf.openapi import EDIT_STEP_VALUE_SCHEMA, number_above
from api.editing.recipe import (
    ASPECTS,
    BANDS,
    CONTROLS,
    CURVE_POINTS,
    DEFAULT_RECIPE,
    ORIENTATIONS,
    TREATMENTS,
    VERSION,
    Json,
    Recipe,
    recipe_from_json,
    recipe_to_json,
)
from api.models import PhotoEdit

# Number choices as (value, label) pairs: ENUM_NAME_OVERRIDES reads them so.
RECIPE_VERSIONS: Final = ((VERSION, VERSION),)
EDIT_ORIENTATIONS: Final = tuple((degrees, degrees) for degrees in ORIENTATIONS)
EDIT_ASPECTS: Final = ASPECTS
EDIT_TREATMENTS: Final = TREATMENTS
HISTORY_ACTIONS: Final = ("set", "crop", "preset", "auto", "paste", "reset", "import")
RENDITION_STATES: Final = tuple(PhotoEdit.Rendition.values)

MAX_HISTORY_STEPS: Final = 200
# A control's dotted path ("light.exposure", "mixer.red.hue") and a step's
# string value (a preset id) are short.
MAX_CONTROL_LENGTH: Final = 64
# The same bound is in its schema (``EDIT_STEP_VALUE_SCHEMA``).
MAX_VALUE_LENGTH: Final = 64
CONTROL_PATH: Final = re.compile(r"[a-z_]+(\.[a-z_]+)*")
# The history as JSON at most: 200 steps of a recipe that sets every
# control stay well under it.
MAX_HISTORY_BYTES: Final = 2_000_000
STEP_KEYS: Final = frozenset({"action", "control", "value", "at", "settings"})


# --- The recipe, for the schema ---------------------------------------------------


def _control(path: str, *, required: bool = False) -> serializers.FloatField:
    control = CONTROLS[path]
    return serializers.FloatField(
        min_value=control.minimum,
        max_value=control.maximum,
        required=required,
        help_text=f"Default {control.default:g}",
    )


def _curve() -> serializers.ListField:
    low, high = CURVE_POINTS
    point = CONTROLS["curve.point"]
    return serializers.ListField(
        child=serializers.ListField(
            child=serializers.FloatField(
                min_value=point.minimum, max_value=point.maximum
            ),
            min_length=2,
            max_length=2,
        ),
        min_length=low,
        max_length=high,
        required=False,
        help_text="Points [x, y], x strictly increasing; default [[0, 0], [1, 1]]",
    )


# A crop's width and height share one range, whose minimum is exclusive: the
# parser refuses a crop of no width or height.
CROP_SIZE: Final = CONTROLS["geometry.crop.w"]


@extend_schema_field(number_above(CROP_SIZE.minimum, CROP_SIZE.maximum))
class CropSizeField(serializers.FloatField):
    """A crop's width or height: above 0, at most the whole picture.

    The bounds are only in its schema: a min_value validator would make
    drf-spectacular drop ``exclusiveMinimum``, and the recipe parser is what
    checks a crop.
    """


def _crop_size() -> CropSizeField:
    return CropSizeField(
        help_text=f"Above {CROP_SIZE.minimum:g}; default {CROP_SIZE.default:g}"
    )


class EditCropSerializer(serializers.Serializer[None]):
    """A crop: centre and size in parts of the oriented picture (w and h above 0)."""

    cx = _control("geometry.crop.cx", required=True)
    cy = _control("geometry.crop.cy", required=True)
    w = _crop_size()
    h = _crop_size()


class EditGeometrySerializer(serializers.Serializer[None]):
    orientation = serializers.ChoiceField(
        choices=EDIT_ORIENTATIONS,
        required=False,
        help_text="Quarter turns clockwise, in degrees",
    )
    flip_h = serializers.BooleanField(required=False)
    flip_v = serializers.BooleanField(required=False)
    straighten = _control("geometry.straighten")
    crop = EditCropSerializer(required=False, allow_null=True)
    aspect = serializers.ChoiceField(
        choices=EDIT_ASPECTS,
        required=False,
        allow_null=True,
        help_text="The aspect ratio the crop is locked to (the editor's lock only)",
    )


class EditWhiteBalanceSerializer(serializers.Serializer[None]):
    temp = _control("wb.temp")
    tint = _control("wb.tint")


class EditLightSerializer(serializers.Serializer[None]):
    exposure = _control("light.exposure")
    contrast = _control("light.contrast")
    highlights = _control("light.highlights")
    shadows = _control("light.shadows")
    whites = _control("light.whites")
    blacks = _control("light.blacks")


class EditCurveSerializer(serializers.Serializer[None]):
    master = _curve()
    red = _curve()
    green = _curve()
    blue = _curve()


class EditColorSerializer(serializers.Serializer[None]):
    vibrance = _control("color.vibrance")
    saturation = _control("color.saturation")
    treatment = serializers.ChoiceField(choices=EDIT_TREATMENTS, required=False)


class EditBandSerializer(serializers.Serializer[None]):
    """One band of the colour mixer."""

    hue = _control("mixer.red.hue")
    sat = _control("mixer.red.sat")
    lum = _control("mixer.red.lum")


class EditMixerSerializer(serializers.Serializer[None]):
    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        return {band: EditBandSerializer(required=False) for band in BANDS}


class EditBwMixSerializer(serializers.Serializer[None]):
    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        return {band: _control(f"bw_mix.{band}") for band in BANDS}


class EditWheelSerializer(serializers.Serializer[None]):
    """One colour grading wheel."""

    hue = _control("grading.shadows.hue")
    sat = _control("grading.shadows.sat")
    lum = _control("grading.shadows.lum")


class EditGradingSerializer(serializers.Serializer[None]):
    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        # "global" is a Python keyword, so the wheels are not class attributes.
        fields: dict[str, serializers.Field[Any, Any, Any, Any]] = {
            wheel: EditWheelSerializer(required=False)
            for wheel in ("shadows", "midtones", "highlights", "global")
        }
        fields["blending"] = _control("grading.blending")
        fields["balance"] = _control("grading.balance")
        return fields


class EditEffectsSerializer(serializers.Serializer[None]):
    texture = _control("effects.texture")
    clarity = _control("effects.clarity")
    dehaze = _control("effects.dehaze")


class EditVignetteSerializer(serializers.Serializer[None]):
    amount = _control("vignette.amount")
    midpoint = _control("vignette.midpoint")
    feather = _control("vignette.feather")
    roundness = _control("vignette.roundness")


class EditGrainSerializer(serializers.Serializer[None]):
    amount = _control("grain.amount")
    size = _control("grain.size")
    roughness = _control("grain.roughness")
    seed = serializers.IntegerField(
        min_value=int(CONTROLS["grain.seed"].minimum),
        max_value=int(CONTROLS["grain.seed"].maximum),
        required=False,
    )


class EditDetailSerializer(serializers.Serializer[None]):
    sharpen_amount = _control("detail.sharpen_amount")
    sharpen_radius = _control("detail.sharpen_radius")
    nr_luminance = _control("detail.nr_luminance")
    nr_color = _control("detail.nr_color")


class EditRecipeSerializer(serializers.Serializer[None]):
    """An edit recipe: sparse, a missing key is its default; unknown keys are refused."""

    version = serializers.ChoiceField(choices=RECIPE_VERSIONS)
    geometry = EditGeometrySerializer(required=False)
    wb = EditWhiteBalanceSerializer(required=False)
    light = EditLightSerializer(required=False)
    curve = EditCurveSerializer(required=False)
    color = EditColorSerializer(required=False)
    mixer = EditMixerSerializer(required=False)
    bw_mix = EditBwMixSerializer(required=False)
    grading = EditGradingSerializer(required=False)
    effects = EditEffectsSerializer(required=False)
    vignette = EditVignetteSerializer(required=False)
    grain = EditGrainSerializer(required=False)
    detail = EditDetailSerializer(required=False)


@extend_schema_field(EDIT_STEP_VALUE_SCHEMA)
class StepValueField(serializers.JSONField):
    """A step's new value: a number, a boolean or a short string."""


class EditHistoryStepSerializer(serializers.Serializer[None]):
    """One step of an edit's history: what it did and the recipe after it."""

    action = serializers.ChoiceField(choices=HISTORY_ACTIONS)
    control = serializers.CharField(
        max_length=MAX_CONTROL_LENGTH,
        required=False,
        allow_null=True,
        help_text="The dotted path of the control a set step changed",
    )
    value = StepValueField(required=False)
    at = serializers.DateTimeField()
    settings = EditRecipeSerializer()


class _ParsedJSONField(serializers.Field[object, object, object, object]):
    """JSON taken and answered as it is: ``PhotoEditUpdateRequest.validate`` checks it.

    Not DRF's ``JSONField``: its own check (encoding it without NaN or
    infinity) would refuse a number too large for a float with a bare
    ``invalid``; the parsers answer that with the error code and the dotted
    path of the documented 400.
    """

    def to_internal_value(self, data: object) -> object:
        return data

    def to_representation(self, value: object) -> object:
        return value


@extend_schema_field(EditRecipeSerializer)
class RecipeField(_ParsedJSONField):
    """A recipe as its JSON; ``PhotoEditUpdateRequest.validate`` parses it."""


@extend_schema_field(EditHistoryStepSerializer(many=True))
class HistoryField(_ParsedJSONField):
    """The history steps as their JSON; ``PhotoEditUpdateRequest.validate`` checks them."""


# --- Reading a recipe and a history --------------------------------------------


def _invalid(field: str, message: str, code: str) -> serializers.ValidationError:
    return serializers.ValidationError({field: [message]}, code=code)


def parse_recipe(data: object, field: str) -> Recipe:
    """The recipe ``data`` describes; a 400 naming the dotted path at fault.

    ``recipe_from_json`` says which control (``light.exposure: ...``); the
    error's field is that path under ``field``.
    """
    try:
        return recipe_from_json(data)
    except ValueError as error:
        path, _, message = str(error).partition(": ")
        if not message:
            path, message = "recipe", path
        where = field if path == "recipe" else f"{field}.{path}"
        raise _invalid(where, message, "invalid_recipe") from error


def _step_value(value: object, field: str) -> Json:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        try:
            finite = math.isfinite(value)
        except OverflowError:
            # An integer too large for a float.
            finite = False
        if not finite:
            raise _invalid(field, "Expected a finite number.", "invalid_step")
        return value
    if isinstance(value, str) and len(value) <= MAX_VALUE_LENGTH:
        return value
    raise _invalid(
        field,
        f"Expected a number, a boolean or a string of at most {MAX_VALUE_LENGTH} characters.",
        "invalid_step",
    )


def _step_control(control: object, field: str) -> str | None:
    if control is None:
        return None
    if (
        not isinstance(control, str)
        or len(control) > MAX_CONTROL_LENGTH
        or not CONTROL_PATH.fullmatch(control)
    ):
        raise _invalid(field, "Expected a dotted control path.", "invalid_step")
    return control


def _step_time(at: object, field: str) -> str:
    if isinstance(at, str):
        try:
            datetime.datetime.fromisoformat(at)
        except ValueError:
            pass
        else:
            return at
    raise _invalid(field, "Expected an ISO 8601 timestamp.", "invalid_step")


def _history_step(step: object, index: int) -> tuple[dict[str, Json], Recipe]:
    """One step, checked, with its recipe in normal form; and that recipe."""
    field = f"history.{index}"
    if not isinstance(step, dict):
        raise _invalid(field, "Expected an object.", "invalid_step")
    unknown = sorted(set(step) - STEP_KEYS)
    if unknown:
        raise _invalid(field, f"Unknown keys {', '.join(unknown)}.", "invalid_step")
    action = step.get("action")
    if action not in HISTORY_ACTIONS:
        raise _invalid(
            f"{field}.action",
            f"Expected one of {', '.join(HISTORY_ACTIONS)}.",
            "invalid_step",
        )
    if "settings" not in step:
        raise _invalid(f"{field}.settings", "This field is required.", "invalid_step")
    recipe = parse_recipe(step["settings"], f"{field}.settings")
    out: dict[str, Json] = {
        "action": str(action),
        "at": _step_time(step.get("at"), f"{field}.at"),
        "settings": recipe_to_json(recipe),
    }
    control = _step_control(step.get("control"), f"{field}.control")
    if control is not None:
        out["control"] = control
    value = _step_value(step.get("value"), f"{field}.value")
    if value is not None:
        out["value"] = value
    return out, recipe


def parse_history(data: object) -> list[tuple[dict[str, Json], Recipe]]:
    """The history steps, checked: at most 200, each with a valid recipe."""
    if not isinstance(data, list):
        raise _invalid("history", "Expected a list of steps.", "invalid_history")
    if len(data) > MAX_HISTORY_STEPS:
        raise _invalid(
            "history",
            f"At most {MAX_HISTORY_STEPS} steps.",
            "too_many_steps",
        )
    if len(json.dumps(data)) > MAX_HISTORY_BYTES:
        raise _invalid("history", "The history is too large.", "too_large")
    return [_history_step(step, index) for index, step in enumerate(data)]


class PhotoEditUpdateRequest(serializers.Serializer[None]):
    """The body of ``PUT /api/photos/<photo_id>/edit/``.

    ``settings`` is the recipe of the step under ``history_cursor`` (the
    default recipe at -1); with an empty history the cursor is -1.
    """

    settings = RecipeField()
    history = HistoryField()
    history_cursor = serializers.IntegerField(min_value=-1)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        recipe = parse_recipe(attrs["settings"], "settings")
        steps = parse_history(attrs["history"])
        cursor: int = attrs["history_cursor"]
        if cursor > len(steps) - 1:
            raise _invalid(
                "history_cursor",
                f"Expected -1 to {len(steps) - 1}.",
                "invalid_cursor",
            )
        if steps:
            expected = DEFAULT_RECIPE if cursor == -1 else steps[cursor][1]
            if recipe != expected:
                raise _invalid(
                    "settings",
                    "The settings are not the recipe of the step under the cursor.",
                    "settings_mismatch",
                )
        return {
            "settings": recipe,
            "history": [step for step, _ in steps],
            "history_cursor": cursor,
        }


# --- Responses -------------------------------------------------------------------


class PhotoEditStateSerializer(serializers.Serializer[PhotoEdit]):
    """``GET``/``PUT /api/photos/<photo_id>/edit/``: a photo's edit.

    A photo never edited answers the default recipe with ``version`` 0 and
    ``updated_at`` null.
    """

    photo_id = serializers.UUIDField()
    settings = RecipeField()
    history = HistoryField()
    history_cursor = serializers.IntegerField(min_value=-1)
    version = serializers.IntegerField(min_value=0)
    rendition = serializers.ChoiceField(choices=RENDITION_STATES)
    updated_at = serializers.DateTimeField(allow_null=True)


class PhotoEditSummary(TypedDict):
    version: int
    rendition: str
    width: int
    height: int


class PhotoEditSummarySerializer(serializers.Serializer[None]):
    """``Photo.edit``: the edited picture of a photo with a rendition, owner only."""

    version = serializers.IntegerField()
    rendition = serializers.ChoiceField(choices=RENDITION_STATES)
    width = serializers.IntegerField()
    height = serializers.IntegerField()


def edit_summary(edit: PhotoEdit | None) -> PhotoEditSummary | None:
    """``Photo.edit``: null without a rendition."""
    if edit is None or not edit.shown or edit.width is None or edit.height is None:
        return None
    return {
        "version": edit.version,
        "rendition": edit.rendition,
        "width": edit.width,
        "height": edit.height,
    }
