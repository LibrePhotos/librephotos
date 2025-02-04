import datetime
import operator
from functools import reduce

from django.db.models import Q
from rest_framework import filters

from api import util
from api.image_similarity import search_similar_embedding
from api.semantic_search import calculate_query_embeddings


class SemanticSearchFilter(filters.SearchFilter):
    def filter_queryset(self, request, queryset, view):
        search_fields = self.get_search_fields(view, request)
        search_terms = self.get_search_terms(request)

        if not search_fields or not search_terms:
            return queryset

        orm_lookups = [
            self.construct_search(str(search_field), queryset=queryset)
            for search_field in search_fields
        ]

        if request.user.semantic_search_topk > 0:
            query = request.query_params.get("search")
            start = datetime.datetime.now()
            emb, magnitude = calculate_query_embeddings(query)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                "finished calculating query embedding - took %.2f seconds" % (elapsed)
            )
            start = datetime.datetime.now()
            image_hashes = search_similar_embedding(
                request.user.id, emb, request.user.semantic_search_topk, threshold=27
            )
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info("search similar embedding - took %.2f seconds" % (elapsed))
        conditions = []
        for search_term in search_terms:
            queries = [Q(**{orm_lookup: search_term}) for orm_lookup in orm_lookups]

            if request.user.semantic_search_topk > 0:
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
