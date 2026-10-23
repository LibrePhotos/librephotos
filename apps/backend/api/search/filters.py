from __future__ import annotations

import datetime
import logging
import operator
from functools import reduce
from typing import TypeVar, cast

import requests
from django.contrib.postgres.search import SearchQuery, SearchVector
from django.db import connection
from django.db.models import Model, Q, QuerySet
from rest_framework import filters
from rest_framework.request import Request
from rest_framework.views import APIView

from api.albums.timeline_filter import timeline_filter_q
from api.drf.request_user import request_user
from api.models.photo_search import fold
from api.models.tag import Tag
from api.models.user_place import UserPlace
from api.search.metadata_filter import metadata_filter_q, parse_metadata_filter
from api.search.semantic import calculate_query_embeddings
from api.search.similarity import search_similar_embedding

# The filter is only used on photo lists, but DRF's BaseFilterBackend is generic
# in the model, and an override has to accept every queryset the base accepts.
_ModelT = TypeVar("_ModelT", bound=Model)
_RowT = TypeVar("_RowT")

logger = logging.getLogger(__name__)

# OCR text is multilingual, so we deliberately use the "simple" text-search
# config (no language-specific stemming, which would be wrong for text that may
# be in any language / a mix of languages). The functional GIN index created in
# migration 0135 uses the same config so the query can use it.
OCR_SEARCH_CONFIG = "simple"


def annotate_ocr_search(
    queryset: QuerySet[_ModelT, _RowT],
) -> QuerySet[_ModelT, _RowT]:
    """Add the ``ocr_search`` tsvector annotation used by the Postgres OCR match.

    Only meaningful on Postgres; other backends use the ``icontains`` fallback
    and never look at the annotation, so we skip it there. ``ocr`` is a
    OneToOne reverse relation, so the LEFT JOIN it introduces cannot fan out
    rows (at most one OCR row per photo).
    """
    # annotate keeps the model and row types; the stubs widen the model to Model.
    return cast(
        QuerySet[_ModelT, _RowT],
        queryset.annotate(
            ocr_search=SearchVector("ocr__text", config=OCR_SEARCH_CONFIG)
        ),
    )


def build_ocr_search_q(search_term: str, vendor: str) -> Q:
    """Return a ``Q`` matching a photo whose OCR text contains ``search_term``.

    The branch is selected purely from ``vendor`` (``connection.vendor``) so it
    can be unit-tested without a real database connection:

    * ``postgresql`` -> full-text match against the ``ocr_search`` annotation
      added by :func:`annotate_ocr_search`, using the ``simple`` config. This is
      backed at query time by the functional GIN index from migration 0135.
    * anything else (SQLite in CI) -> a case-insensitive substring match on the
      raw ``ocr__text`` column.

    ``ocr`` is a OneToOne reverse relation, so neither path can duplicate rows.
    """
    if vendor == "postgresql":
        return Q(ocr_search=SearchQuery(search_term, config=OCR_SEARCH_CONFIG))
    return Q(ocr__text__icontains=search_term)


def build_user_place_q(folded_term: str, folded_places: dict[int, str]) -> Q:
    """Return a ``Q`` matching the photos of the requester's own places (#1365)
    whose folded name contains ``folded_term``: a search for "home" finds
    the photos of "Home".

    ``folded_places`` holds only the requester's places (place id -> folded
    name), so a place name never finds another user's photos, and nothing is
    written into the photo's own search row, which shared and public views
    read.
    """
    place_ids = [pid for pid, name in folded_places.items() if folded_term in name]
    if not place_ids:
        return Q(pk__in=[])
    inside = UserPlace.photos.through.objects.filter(userplace_id__in=place_ids)
    return Q(pk__in=inside.values("photo_id"))


def build_folded_search_q(folded_term: str, folded_tags: dict[int, str]) -> Q:
    """Return a ``Q`` matching ``folded_term`` with case and accents ignored.

    ``folded_term`` is a search term after :func:`api.models.photo_search.fold`,
    so "Zurich" finds "Zürich" and "Zürich" finds "Zurich" (#659). It is matched
    against the folded captions and location (``PhotoSearch.search_folded``)
    and against ``folded_tags`` (tag id -> folded name, the requester's tags
    only). Tag names are folded in Python because neither SQLite nor Postgres
    without the unaccent extension can fold a column at query time, and a user
    has few tags. The tag match is a subquery, so it adds no join that could
    repeat a photo.
    """
    query = Q(search_instance__search_folded__icontains=folded_term)
    tag_ids = [tag_id for tag_id, name in folded_tags.items() if folded_term in name]
    if tag_ids:
        tagged = Tag.photos.through.objects.filter(tag_id__in=tag_ids)
        query |= Q(pk__in=tagged.values("photo_id"))
    return query


class SemanticSearchFilter(filters.SearchFilter):
    @staticmethod
    def _folded_tags(request: Request, search_fields: list[str]) -> dict[int, str]:
        """The requester's tags by id, with folded names, when the view
        searches tag names at all."""
        if "tags__name" not in search_fields:
            return {}
        tags = Tag.objects.owned_by(request_user(request)).values_list("id", "name")
        return {tag_id: fold(name) for tag_id, name in tags}

    @staticmethod
    def _folded_user_places(
        request: Request, search_fields: list[str]
    ) -> dict[int, str]:
        """The requester's places by id, with folded names, when the view
        searches place names at all."""
        if "search_instance__search_location" not in search_fields:
            return {}
        places = UserPlace.objects.owned_by(request_user(request))
        return {pid: fold(name) for pid, name in places.values_list("id", "name")}

    def _semantic_matches(self, request: Request) -> list[str]:
        """Hashes of the requester's photos closest to the query, by the
        semantic search model (api.search.semantic), at its threshold."""
        user = request_user(request)
        query = request.query_params.get("search")
        start = datetime.datetime.now()
        emb, magnitude = calculate_query_embeddings(query)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info("finished calculating query embedding - took %.2f seconds", elapsed)
        start = datetime.datetime.now()
        image_hashes = search_similar_embedding(user.id, emb, user.semantic_search_topk)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info("search similar embedding - took %.2f seconds", elapsed)
        return image_hashes

    def filter_queryset(
        self,
        request: Request,
        queryset: QuerySet[_ModelT, _RowT],
        view: APIView,
    ) -> QuerySet[_ModelT, _RowT]:
        # Narrow by media type and category (video/photo, is_screenshot,
        # is_document) independent of the search term, parsed like the
        # album-date endpoints do (tri-state). Search never applies the saved
        # timeline default or the favorites filter. This is applied before the
        # no-search-term early return so the filter works whether or not a
        # query is supplied.
        media_params = {
            param: request.query_params.get(param)
            for param in ("video", "photo", "is_screenshot", "is_document")
        }
        queryset = queryset.filter(*timeline_filter_q(request.user, media_params))
        # The structured filters (camera, exposure, rating, dates, location,
        # file type, people) narrow the same way, with or without a term; a
        # bad value is a 400 naming the parameter.
        metadata = parse_metadata_filter(request_user(request), request.query_params)
        queryset = queryset.filter(*metadata_filter_q(metadata))

        search_fields = self.get_search_fields(view, request)
        search_terms = self.get_search_terms(request)

        if not search_fields or not search_terms:
            return queryset

        # Fold OCR text into the search: a photo whose extracted OCR text
        # matches the terms is returned alongside caption/location/tag matches.
        # On Postgres this is a full-text match; elsewhere (SQLite) it degrades
        # to a substring match. The base queryset is already owner-scoped by the
        # view's get_queryset, so this preserves ownership scoping.
        vendor = connection.vendor
        if vendor == "postgresql":
            queryset = annotate_ocr_search(queryset)

        orm_lookups = [
            self.construct_search(str(search_field), queryset=queryset)
            for search_field in search_fields
        ]

        image_hashes = None
        if request_user(request).semantic_search_topk > 0:
            try:
                image_hashes = self._semantic_matches(request)
            except (requests.RequestException, KeyError, ValueError) as error:
                # The text, tag and OCR matches still answer while the CLIP
                # sidecar is down, busy or missing its model.
                logger.warning(
                    "semantic search unavailable, using the text match only: %s",
                    error,
                )
        fields = [str(f) for f in search_fields]
        folded_tags = self._folded_tags(request, fields)
        folded_places = self._folded_user_places(request, fields)
        conditions = []
        for search_term in search_terms:
            queries = [Q(**{orm_lookup: search_term}) for orm_lookup in orm_lookups]
            queries.append(build_folded_search_q(fold(search_term), folded_tags))
            queries.append(build_user_place_q(fold(search_term), folded_places))

            # OR the OCR match in per-term, matching the shape of the field
            # lookups above: each term may be satisfied by any field or by the
            # OCR text, and terms are AND-ed together (reduce(and_) below).
            queries.append(build_ocr_search_q(search_term, vendor))

            if image_hashes is not None:
                queries += [Q(image_hash__in=image_hashes)]

            conditions.append(reduce(operator.or_, queries))
        queryset = queryset.filter(reduce(operator.and_, conditions))

        if self.must_call_distinct(queryset, search_fields):
            # Filtering against a many-to-many field requires us to
            # call queryset.distinct() in order to avoid duplicate items
            # in the resulting queryset.
            # We try to avoid this if possible, for performance reasons.
            queryset = queryset.distinct()
        return queryset
