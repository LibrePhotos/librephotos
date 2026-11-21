from __future__ import annotations

import datetime
import uuid
from collections.abc import Mapping, Sequence

from django.apps import apps
from django.db import models

MODEL = "__model__"
TUPLE = "__tuple__"
UUID = "__uuid__"
DATETIME = "__datetime__"
DATE = "__date__"
MARKERS = frozenset({MODEL, TUPLE, UUID, DATETIME, DATE})

type Encoded = None | bool | int | float | str | list[Encoded] | dict[str, Encoded]


class MissingArgumentError(LookupError):
    pass


def encode(value: object) -> Encoded:
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, tuple):
        return {TUPLE: [encode(item) for item in value]}
    if isinstance(value, list | set | frozenset):
        return [encode(item) for item in value]
    if isinstance(value, Mapping):
        return _encode_mapping(value)
    return _encode_object(value)


def _encode_object(value: object) -> Encoded:
    if isinstance(value, models.Model):
        if value.pk is None:
            raise TypeError(f"an unsaved {type(value).__name__} cannot be queued")
        return {MODEL: value._meta.label_lower, "pk": encode(value.pk)}
    if isinstance(value, uuid.UUID):
        return {UUID: str(value)}
    if isinstance(value, datetime.datetime):
        return {DATETIME: value.isoformat()}
    if isinstance(value, datetime.date):
        return {DATE: value.isoformat()}
    raise TypeError(
        f"{type(value).__name__} cannot be queued: pass ids, strings, numbers, "
        "lists, dicts, UUIDs, dates or saved model instances"
    )


def _encode_mapping(value: Mapping[str, object]) -> dict[str, Encoded]:
    encoded: dict[str, Encoded] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TypeError(f"a queued dict needs string keys, not {key!r}")
        if key in MARKERS:
            raise TypeError(f"a queued dict cannot use the key {key!r}")
        encoded[key] = encode(item)
    return encoded


def encode_args(args: Sequence[object]) -> list[Encoded]:
    return [encode(arg) for arg in args]


def encode_kwargs(kwargs: Mapping[str, object]) -> dict[str, Encoded]:
    return _encode_mapping(kwargs)


def decode(value: object) -> object:
    if isinstance(value, list):
        return [decode(item) for item in value]
    if not isinstance(value, dict):
        return value
    marker = next((key for key in value if key in MARKERS), None)
    if marker is None:
        return {key: decode(item) for key, item in value.items()}
    return _decode_marked(marker, value)


def _decode_marked(marker: str, value: dict[str, object]) -> object:
    if marker == MODEL:
        return _load_instance(str(value[MODEL]), decode(value.get("pk")))
    if marker == TUPLE:
        items = value[TUPLE]
        return tuple(decode(item) for item in items) if isinstance(items, list) else ()
    text = str(value[marker])
    if marker == UUID:
        return uuid.UUID(text)
    if marker == DATETIME:
        return datetime.datetime.fromisoformat(text)
    return datetime.date.fromisoformat(text)


def decode_args(args: object) -> list[object]:
    return [decode(arg) for arg in args] if isinstance(args, list) else []


def decode_kwargs(kwargs: object) -> dict[str, object]:
    if not isinstance(kwargs, dict):
        return {}
    return {str(key): decode(item) for key, item in kwargs.items()}


def _load_instance(label: str, pk: object) -> models.Model:
    try:
        model = apps.get_model(label)
    except LookupError as error:
        raise MissingArgumentError(f"the model {label} no longer exists") from error
    instance = model._base_manager.filter(pk=pk).first()
    if instance is None:
        raise MissingArgumentError(f"{label} {pk} no longer exists")
    return instance
