from rest_framework.pagination import PageNumberPagination


class HugeResultsSetPagination(PageNumberPagination):
    page_size = 2500
    page_size_query_param = "page_size"
    max_page_size = 5000


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 1000
    page_size_query_param = "page_size"
    max_page_size = 2000


class RegularResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = "page_size"
    max_page_size = 200


class TinyResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50
