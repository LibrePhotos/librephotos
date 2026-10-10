import datetime
import logging
import operator
from functools import reduce

import requests
from django.contrib.postgres.search import SearchQuery, SearchVector
from django.db import connection
from django.db.models import Q
from rest_framework import filters

from api.image_similarity import search_similar_embedding
from api.semantic_search import calculate_query_embeddings
from api.timeline_filter import timeline_filter_q

logger = logging.getLogger(__name__)

# OCR text is multilingual, so we deliberately use the "simple" text-search
# config (no language-specific stemming, which would be wrong for text that may
# be in any language / a mix of languages). The functional GIN index created in
# migration 0135 uses the same config so the query can use it.
OCR_SEARCH_CONFIG = "simple"


def annotate_ocr_search(queryset):
    """Add the ``ocr_search`` tsvector annotation used by the Postgres OCR match.

    Only meaningful on Postgres; other backends use the ``icontains`` fallback
    and never look at the annotation, so we skip it there. ``ocr`` is a
    OneToOne reverse relation, so the LEFT JOIN it introduces cannot fan out
    rows (at most one OCR row per photo).
    """
    return queryset.annotate(
        ocr_search=SearchVector("ocr__text", config=OCR_SEARCH_CONFIG)
    )


def build_ocr_search_q(search_term, vendor):
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


class SemanticSearchFilter(filters.SearchFilter):
    def _semantic_matches(self, request):
        """Hashes of the requester's photos closest to the query, by the
        semantic search model (api.semantic_search), at its threshold."""
        query = request.query_params.get("search")
        start = datetime.datetime.now()
        emb, magnitude = calculate_query_embeddings(query)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info("finished calculating query embedding - took %.2f seconds", elapsed)
        start = datetime.datetime.now()
        image_hashes = search_similar_embedding(
            request.user.id, emb, request.user.semantic_search_topk
        )
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info("search similar embedding - took %.2f seconds", elapsed)
        return image_hashes

    def filter_queryset(self, request, queryset, view):
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
        if request.user.semantic_search_topk > 0:
            try:
                image_hashes = self._semantic_matches(request)
            except (requests.RequestException, KeyError, ValueError) as error:
                # The text, tag and OCR matches still answer while the CLIP
                # sidecar is down, busy or missing its model.
                logger.warning(
                    "semantic search unavailable, using the text match only: %s",
                    error,
                )
        conditions = []
        for search_term in search_terms:
            queries = [Q(**{orm_lookup: search_term}) for orm_lookup in orm_lookups]

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
