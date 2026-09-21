"""Characterization tests for ``api.drf_optimize`` (unit 9).

Pins the CURRENT behaviour of
``OptimizeRelatedModelViewSetMetaclass.__new__`` and
``OptimizeRelatedModelViewSetMetaclass.get_many_to_one_rel`` before the
metaclass is refactored.

These tests deliberately assert what the code does *today*, including several
quirks/bugs that are called out in comments (shared-list aliasing, the
many-to-one prefetch being gated on many-to-many being non-empty, and the
unreachable ``IndexError`` handler).

Nothing here touches the network, ML models or exiftool: the metaclass is
pure class-construction logic over Django model metadata.
"""

from unittest.mock import Mock

from django.db import ProgrammingError, models
from django.test import TestCase
from rest_framework import serializers
from rest_framework.utils import model_meta

from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass as Meta
from api.models import AlbumUser, Photo
from api.tests.utils import create_test_user


def prefetch_names(queryset):
    """Names of the lookups queued by ``prefetch_related`` on ``queryset``."""
    return sorted(p.prefetch_through for p in queryset._prefetch_related_lookups)


def select_related_value(queryset):
    return queryset.query.select_related


def build(name="V", bases=(), **attrs):
    """Run the metaclass over a fresh class body and return the class."""
    return Meta(name, bases, dict(attrs))


ALBUM_INFO = None


def album_info():
    global ALBUM_INFO
    if ALBUM_INFO is None:
        ALBUM_INFO = model_meta.get_field_info(AlbumUser)
    return ALBUM_INFO


def make_serializer(fields, **extra):
    """A ModelSerializer over AlbumUser whose ``Meta.fields`` we control."""
    meta = type("Meta", (), {"model": AlbumUser, "fields": list(fields)})
    return type("S", (serializers.ModelSerializer,), {"Meta": meta, **extra})


# ---------------------------------------------------------------------------
# get_many_to_one_rel
# ---------------------------------------------------------------------------


class GetManyToOneRelTest(TestCase):
    """Pin current behaviour of ``get_many_to_one_rel``."""

    def test_returns_nested_lookups_rooted_at_a_forward_foreign_key(self):
        info = album_info()
        self.assertEqual(
            Meta.get_many_to_one_rel(info, {"owner__username"}),
            ["owner__username"],
        )

    def test_bare_foreign_key_name_is_excluded_because_lookups_are_strict(self):
        # strict=True keeps only lookups containing LOOKUP_SEP ("__").
        self.assertEqual(Meta.get_many_to_one_rel(album_info(), {"owner"}), [])

    def test_nested_lookup_rooted_at_many_to_many_is_excluded(self):
        # "photos" is a ManyToManyField, not a ForeignKey.
        self.assertEqual(
            Meta.get_many_to_one_rel(album_info(), {"photos__image_hash"}), []
        )

    def test_nested_lookup_rooted_at_plain_field_is_excluded(self):
        self.assertEqual(
            Meta.get_many_to_one_rel(album_info(), {"title__icontains"}), []
        )

    def test_multiple_foreign_keys_and_deep_lookups(self):
        result = Meta.get_many_to_one_rel(
            album_info(),
            {
                "owner__username",
                "cover_photo__owner__username",
                "cover_photo",
                "photos__owner",
                "id",
            },
        )
        self.assertEqual(
            sorted(result), ["cover_photo__owner__username", "owner__username"]
        )

    def test_empty_meta_fields_returns_empty_list(self):
        self.assertEqual(Meta.get_many_to_one_rel(album_info(), set()), [])

    def test_model_without_forward_relations_returns_empty_list(self):
        info = Mock(forward_relations={})
        self.assertEqual(Meta.get_many_to_one_rel(info, {"owner__username"}), [])

    def test_forward_relation_that_is_not_a_foreign_key_is_ignored(self):
        # Only ForeignKey subclasses qualify; a plain relation object does not.
        info = Mock(forward_relations={"owner": (models.ManyToManyField(Photo),)})
        self.assertEqual(Meta.get_many_to_one_rel(info, {"owner__username"}), [])

    def test_one_to_one_counts_as_foreign_key(self):
        # OneToOneField subclasses ForeignKey, so it is treated as many-to-one.
        info = Mock(
            forward_relations={"prof": (models.OneToOneField(Photo, models.CASCADE),)}
        )
        self.assertEqual(Meta.get_many_to_one_rel(info, {"prof__x"}), ["prof__x"])

    def test_return_type_is_a_list_not_the_input_set(self):
        result = Meta.get_many_to_one_rel(album_info(), {"owner__username"})
        self.assertIsInstance(result, list)

    def test_index_error_handler_is_unreachable_in_practice(self):
        # The `except IndexError` branch exists but forward_relations values are
        # always non-empty tuples, so it never fires in production. Forcing an
        # empty relation_info shows the handler's only observable effect:
        # the IndexError is swallowed and [] is returned.
        info = Mock(forward_relations={"owner": ()})
        self.assertEqual(Meta.get_many_to_one_rel(info, {"owner__x"}), [])


# ---------------------------------------------------------------------------
# __new__
# ---------------------------------------------------------------------------


class MetaclassNewTest(TestCase):
    """Pin current behaviour of ``OptimizeRelatedModelViewSetMetaclass.__new__``."""

    def setUp(self):
        # IMPORTANT: `if queryset:` evaluates the queryset's *truthiness*, which
        # runs the query. An empty table therefore disables every optimisation
        # (see test_empty_queryset_short_circuits_all_optimisation below), so
        # the rest of these tests need at least one row to exist.
        self.user = create_test_user()
        AlbumUser.objects.create(title="a", owner=self.user)

    # ---- no serializer / no queryset --------------------------------

    def test_plain_class_without_queryset_or_serializer(self):
        klass = build()
        self.assertFalse(hasattr(klass, "queryset"))
        self.assertIsInstance(klass, Meta)

    def test_empty_queryset_short_circuits_all_optimisation(self):
        # QUIRK/BUG: truthiness of a QuerySet hits the database. When the table
        # is empty at class-creation time nothing is applied at all -- not even
        # the `.all()` rebind -- so the class keeps the exact object it was
        # given.
        qs = AlbumUser.objects.filter(title="does-not-exist")
        serializer = make_serializer(["id", "photos", "owner"])
        klass = build(queryset=qs, serializer_class=serializer)
        self.assertIs(klass.queryset, qs)
        self.assertEqual(prefetch_names(klass.queryset), [])
        self.assertFalse(select_related_value(klass.queryset))

    def test_queryset_without_serializer_is_still_rebuilt_via_all(self):
        qs = AlbumUser.objects.all()
        klass = build(queryset=qs)
        # No optimisation is applied, but `.all()` clones the queryset anyway.
        self.assertIsNot(klass.queryset, qs)
        self.assertEqual(prefetch_names(klass.queryset), [])
        self.assertFalse(select_related_value(klass.queryset))

    def test_non_model_serializer_class_is_ignored(self):
        qs = AlbumUser.objects.all()

        class Plain(serializers.Serializer):
            pass

        klass = build(queryset=qs, serializer_class=Plain)
        self.assertEqual(prefetch_names(klass.queryset), [])
        self.assertFalse(select_related_value(klass.queryset))

    # ---- happy path --------------------------------------------------

    def test_many_to_many_and_forward_relations_from_meta_fields(self):
        serializer = make_serializer(
            ["id", "title", "photos", "shared_to", "owner", "cover_photo"]
        )
        klass = build(queryset=AlbumUser.objects.all(), serializer_class=serializer)
        self.assertEqual(prefetch_names(klass.queryset), ["photos", "shared_to"])
        # select_related is given the forward, non-to_many relations.
        self.assertEqual(
            select_related_value(klass.queryset), {"cover_photo": {}, "owner": {}}
        )

    def test_many_to_one_lookups_are_folded_into_prefetch_related(self):
        serializer = make_serializer(["id", "photos", "owner__username"])
        klass = build(queryset=AlbumUser.objects.all(), serializer_class=serializer)
        self.assertEqual(prefetch_names(klass.queryset), ["owner__username", "photos"])

    def test_many_to_one_prefetch_is_skipped_when_no_many_to_many(self):
        # QUIRK/BUG: the prefetch_related call is gated on `many_to_many_fields`
        # being truthy, so a pure many-to-one lookup is silently dropped.
        serializer = make_serializer(["id", "owner", "owner__username"])
        klass = build(queryset=AlbumUser.objects.all(), serializer_class=serializer)
        self.assertEqual(prefetch_names(klass.queryset), [])
        self.assertEqual(select_related_value(klass.queryset), {"owner": {}})

    def test_serializer_optimisation_is_skipped_without_a_queryset(self):
        serializer = make_serializer(["id", "photos", "owner"])
        klass = build(serializer_class=serializer)
        self.assertFalse(hasattr(klass, "queryset"))

    # ---- _base_forward_rel ------------------------------------------

    def test_base_forward_rel_is_popped_from_the_class_body(self):
        serializer = make_serializer(["id", "photos"])
        klass = build(
            queryset=AlbumUser.objects.all(),
            serializer_class=serializer,
            _base_forward_rel=("owner",),
        )
        # popped from attrs -> the attribute does not land on the new class.
        self.assertNotIn("_base_forward_rel", klass.__dict__)
        self.assertEqual(select_related_value(klass.queryset), {"owner": {}})

    def test_base_forward_rel_is_inherited_from_bases(self):
        parent = build("Parent", (), _base_forward_rel=("cover_photo",))
        # The parent popped its own attribute, so nothing is inherited...
        self.assertFalse(hasattr(parent, "_base_forward_rel"))

        class Holder:
            _base_forward_rel = ("cover_photo",)

        serializer = make_serializer(["id", "photos"])
        klass = build(
            "Child",
            (Holder,),
            queryset=AlbumUser.objects.all(),
            serializer_class=serializer,
        )
        self.assertEqual(select_related_value(klass.queryset), {"cover_photo": {}})

    def test_base_forward_rel_only_selects_fields_that_are_forward_relations(self):
        serializer = make_serializer(["id", "photos"])
        klass = build(
            queryset=AlbumUser.objects.all(),
            serializer_class=serializer,
            _base_forward_rel=("title", "photos", "owner"),
        )
        # "title" is not a relation and "photos" is to_many -> only "owner".
        self.assertEqual(select_related_value(klass.queryset), {"owner": {}})

    # ---- serializer opt-in attributes --------------------------------

    def test_serializer_related_and_many_to_many_attributes_are_honoured(self):
        serializer = make_serializer(
            ["id", "title"],
            _related_fields=["owner"],
            _many_to_many_fields=["photos"],
            _many_to_one_fields=["cover_photo__owner"],
        )
        klass = build(queryset=AlbumUser.objects.all(), serializer_class=serializer)
        self.assertEqual(
            prefetch_names(klass.queryset), ["cover_photo__owner", "photos"]
        )
        self.assertEqual(select_related_value(klass.queryset), {"owner": {}})

    def test_shared_list_aliasing_leaks_fields_across_categories(self):
        # QUIRK/BUG: `many_to_many_fields = many_to_one_fields = related_fields = []`
        # binds ALL THREE names to the same list object, so an .extend() on one
        # is visible through the others. With a ModelSerializer that has no
        # Meta.model, `info` stays None and `related_fields` ends up holding the
        # many-to-many name too -- so "photos" is handed to BOTH
        # prefetch_related() and select_related(). select_related is lazy, so no
        # error is raised at class-creation time; the broken lookup only blows
        # up when the queryset is finally evaluated.
        meta = type("Meta", (), {"fields": ["id"]})
        serializer = type(
            "S",
            (serializers.ModelSerializer,),
            {"Meta": meta, "_many_to_many_fields": ["photos"]},
        )
        klass = build(queryset=AlbumUser.objects.all(), serializer_class=serializer)
        self.assertEqual(prefetch_names(klass.queryset), ["photos"])
        # the leak: a many-to-many name ends up in select_related.
        self.assertEqual(select_related_value(klass.queryset), {"photos": {}})
        with self.assertRaises(Exception):
            list(klass.queryset)

    # ---- error swallowing --------------------------------------------

    def test_programming_error_is_swallowed_and_queryset_left_untouched(self):
        qs = Mock()
        qs.prefetch_related.side_effect = ProgrammingError("relation does not exist")
        serializer = make_serializer(["id", "photos"])
        klass = build(queryset=qs, serializer_class=serializer)
        # attrs["queryset"] was never reassigned, so the original mock survives.
        self.assertIs(klass.queryset, qs)

    def test_other_database_errors_are_not_swallowed(self):
        qs = Mock()
        qs.prefetch_related.side_effect = ValueError("boom")
        serializer = make_serializer(["id", "photos"])
        with self.assertRaises(ValueError):
            build(queryset=qs, serializer_class=serializer)

    # ---- normal class machinery still works --------------------------

    def test_metaclass_preserves_regular_attributes_and_name(self):
        serializer = make_serializer(["id", "photos"])

        def helper(self):
            return 42

        klass = build(
            "MyViewSet",
            (),
            queryset=AlbumUser.objects.all(),
            serializer_class=serializer,
            helper=helper,
            marker="kept",
        )
        self.assertEqual(klass.__name__, "MyViewSet")
        self.assertEqual(klass.marker, "kept")
        self.assertEqual(klass().helper(), 42)
