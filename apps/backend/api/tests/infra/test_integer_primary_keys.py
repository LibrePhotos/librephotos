"""An integer primary key goes out as a number (issue #389).

Six album serializers declare ``id = SerializerMethodField()`` returning
``str(obj.id)``, so one album is ``12`` in a list and ``"12"`` in its detail,
and typed clients compare the two and miss. A serializer of a model with an
integer primary key may declare ``id`` only as a field that sends the number.

The six wait in ``LEGACY_STRING_IDS`` until released mobile builds read
numbers there (they parse these ids with ``z.string()``; the follow-up issue
of #389 tracks the switch). The list only shrinks: a new serializer cannot
join it, and an entry that sends a number again fails until it is removed.
"""

import importlib
import inspect
import pkgutil

from django.db import models
from django.test import SimpleTestCase
from rest_framework import serializers

import api.serializers
from api.models import AlbumUser

# Serializers that still send their integer id as a string, kept for released
# clients. Only shrinks.
LEGACY_STRING_IDS = frozenset(
    {
        "api.serializers.album_date.AlbumDateSerializer",
        "api.serializers.album_date.IncompleteAlbumDateSerializer",
        "api.serializers.album_place.GroupedPlacePhotosSerializer",
        "api.serializers.album_thing.GroupedThingPhotosSerializer",
        "api.serializers.album_user.AlbumUserPublicSerializer",
        "api.serializers.album_user.AlbumUserSerializer",
    }
)

# Field classes that send an integer primary key as the number it is.
NUMERIC_ID_FIELDS: tuple[type[serializers.Field], ...] = (
    serializers.IntegerField,
    serializers.ReadOnlyField,
    serializers.PrimaryKeyRelatedField,
)


def _has_integer_pk(model: type[models.Model]) -> bool:
    # AutoField and BigAutoField are IntegerFields too.
    return isinstance(model._meta.pk, models.IntegerField)


def string_id_serializers(
    candidates: list[type[serializers.ModelSerializer]],
) -> list[str]:
    """The serializers that declare an ``id`` that is not a number for an integer pk."""
    found = []
    for serializer_class in candidates:
        meta = getattr(serializer_class, "Meta", None)
        model = getattr(meta, "model", None)
        if model is None or not _has_integer_pk(model):
            continue
        declared = serializer_class._declared_fields.get("id")
        if declared is not None and not isinstance(declared, NUMERIC_ID_FIELDS):
            found.append(f"{serializer_class.__module__}.{serializer_class.__name__}")
    return found


def api_model_serializers() -> list[type[serializers.ModelSerializer]]:
    """Every ModelSerializer defined in the ``api.serializers`` package."""
    found: list[type[serializers.ModelSerializer]] = []
    for module_info in pkgutil.iter_modules(api.serializers.__path__):
        module = importlib.import_module(f"api.serializers.{module_info.name}")
        for _, member in inspect.getmembers(module, inspect.isclass):
            if (
                issubclass(member, serializers.ModelSerializer)
                and member.__module__ == module.__name__
            ):
                found.append(member)
    return found


class IntegerPrimaryKeyFieldTest(SimpleTestCase):
    def test_the_walk_reaches_the_album_serializers(self):
        names = {cls.__name__ for cls in api_model_serializers()}
        self.assertTrue(
            {"AlbumDateSerializer", "AlbumUserSerializer"} <= names, sorted(names)
        )

    def test_no_new_serializer_sends_an_integer_pk_as_a_string(self):
        found = set(string_id_serializers(api_model_serializers()))
        self.assertEqual(sorted(found - LEGACY_STRING_IDS), [])

    def test_the_legacy_list_has_no_entry_that_sends_a_number(self):
        found = set(string_id_serializers(api_model_serializers()))
        self.assertEqual(sorted(LEGACY_STRING_IDS - found), [])

    def test_a_planted_string_id_is_caught(self):
        class StringIdSerializer(serializers.ModelSerializer):
            id = serializers.SerializerMethodField()

            class Meta:
                model = AlbumUser
                fields = ("id",)

            def get_id(self, obj: AlbumUser) -> str:
                return str(obj.id)

        class CharIdSerializer(serializers.ModelSerializer):
            id = serializers.CharField(read_only=True)

            class Meta:
                model = AlbumUser
                fields = ("id",)

        class NumberIdSerializer(serializers.ModelSerializer):
            class Meta:
                model = AlbumUser
                fields = ("id",)

        found = string_id_serializers(
            [StringIdSerializer, CharIdSerializer, NumberIdSerializer]
        )
        self.assertEqual(
            [name.rsplit(".", 1)[-1] for name in found],
            ["StringIdSerializer", "CharIdSerializer"],
        )
