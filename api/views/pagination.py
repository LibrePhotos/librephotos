from rest_framework.pagination import PageNumberPagination


class HugeResultsSetPagination(PageNumberPagination):
    page_size = 50000
    page_size_query_param = "page_size"
    max_page_size = 100000


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 10000
    page_size_query_param = "page_size"
    max_page_size = 100000


class RegularResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = "page_size"
    max_page_size = 100000


class TinyResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50
