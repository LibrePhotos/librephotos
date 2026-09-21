from django.db import ProgrammingError, models
from django.db.models.constants import LOOKUP_SEP
from django.db.models.query import normalize_prefetch_lookups
from rest_framework import serializers
from rest_framework.utils import model_meta


class OptimizeRelatedModelViewSetMetaclass(type):
    """This metaclass optimizes the queryset using `prefetch_related` and `select_related`.

    Any attribute of `_base_forward_rel` as attributes on either the class or on
    any of its superclasses will be include in the `base_forward_rel`
    they must be ForeignKey fields and only those will be included.

    If the `serializer_class` attribute is an instance of `serializers.ModelSerializer`
    included as an attribute on the class the `serializers.ModelSerializer.Meta.fields`
    is also added calling prefetch_related on Many-To-One and Many-To-Many related objects.
    """

    @classmethod
    def get_many_to_many_rel(cls, info, meta_fields):
        many_to_many_fields = [
            field_name
            for field_name, relation_info in info.relations.items()
            if relation_info.to_many
        ]
        many_to_many_lookups = []
        for lookup_name, lookup in cls.get_lookups(meta_fields):
            if lookup_name in many_to_many_fields:
                many_to_many_lookups.append(lookup)

        return many_to_many_lookups

    @classmethod
    def get_lookups(cls, fields, strict=False):
        field_lookups = [(lookup.split(LOOKUP_SEP, 1)[0], lookup) for lookup in fields]
        if strict:
            field_lookups = [f for f in field_lookups if LOOKUP_SEP in f[1]]
        return field_lookups

    @classmethod
    def get_many_to_one_rel(cls, info, meta_fields):
        try:
            fields = {
                field_name
                for field_name, relation_info in info.forward_relations.items()
                if issubclass(type(relation_info[0]), models.ForeignKey)
            }
        except IndexError:
            return []
        return [
            lookup
            for lookup_name, lookup in cls.get_lookups(meta_fields, strict=True)
            if lookup_name in fields
        ]

    @classmethod
    def get_forward_rel(cls, info, meta_fields):
        return [
            field_name
            for field_name, relation_info in info.forward_relations.items()
            if field_name in meta_fields and not relation_info.to_many
        ]

    @classmethod
    def collect_declared_fields(
        cls, serializer_class, base_forward_rel, many_to_many_fields, many_to_one_fields
    ):
        """Extend the given field lists in place and return the model info, if any."""
        if not serializer_class or not issubclass(
            serializer_class, serializers.ModelSerializer
        ):
            return None

        base_forward_rel.extend(
            list(getattr(serializer_class, "_related_fields", [])),
        )
        many_to_many_fields.extend(
            list(getattr(serializer_class, "_many_to_many_fields", [])),
        )
        many_to_one_fields.extend(
            list(getattr(serializer_class, "_many_to_one_fields", [])),
        )
        if not hasattr(serializer_class.Meta, "model"):
            return None

        info = model_meta.get_field_info(serializer_class.Meta.model)
        meta_fields = list(serializer_class.Meta.fields)
        many_to_many_fields.extend(meta_fields)
        many_to_one_fields.extend(meta_fields)
        base_forward_rel.extend(meta_fields)
        return info

    @classmethod
    def optimize_queryset(
        cls, attrs, many_to_many_fields, many_to_one_fields, related_fields
    ):
        queryset = attrs.get("queryset", None)
        try:
            if not queryset:
                return
            if many_to_many_fields:
                queryset = queryset.prefetch_related(
                    *normalize_prefetch_lookups(
                        set(many_to_many_fields + many_to_one_fields)
                    ),
                )
            if related_fields:
                queryset = queryset.select_related(*related_fields)
            attrs["queryset"] = queryset.all()
        except ProgrammingError:
            pass

    def __new__(cls, name, bases, attrs):
        many_to_many_fields = many_to_one_fields = related_fields = []
        base_forward_rel = list(attrs.pop("_base_forward_rel", ()))

        for base in reversed(bases):
            if hasattr(base, "_base_forward_rel"):
                base_forward_rel.extend(list(base._base_forward_rel))

        info = cls.collect_declared_fields(
            attrs.get("serializer_class", None),
            base_forward_rel,
            many_to_many_fields,
            many_to_one_fields,
        )
        if info is not None:
            many_to_many_fields = cls.get_many_to_many_rel(
                info, set(many_to_many_fields)
            )
            many_to_one_fields = cls.get_many_to_one_rel(info, set(many_to_one_fields))
            related_fields = cls.get_forward_rel(info, set(base_forward_rel))

        cls.optimize_queryset(
            attrs, many_to_many_fields, many_to_one_fields, related_fields
        )
        return super(OptimizeRelatedModelViewSetMetaclass, cls).__new__(
            cls, name, bases, attrs
        )
