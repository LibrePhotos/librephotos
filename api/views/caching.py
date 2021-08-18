from rest_framework_extensions.key_constructor.constructors import DefaultKeyConstructor
from rest_framework_extensions.key_constructor.bits import (
    KeyBitBase,
    ListSqlQueryKeyBit,
    PaginationKeyBit,
    RetrieveSqlQueryKeyBit,
)
from django.core.cache import cache
import datetime
from django.utils.encoding import force_text


CACHE_TTL = 60 * 60 * 24  # 1 day
CACHE_TTL_VIZ = 60 * 60  # 1 hour

# caching stuff straight out of https://chibisov.github.io/drf-extensions/docs/#caching
class UpdatedAtKeyBit(KeyBitBase):
    def get_data(self, **kwargs):
        key = "api_updated_at_timestamp"
        value = cache.get(key, None)
        if not value:
            value = datetime.datetime.utcnow()
            cache.set(key, value=value)
        return force_text(value)


class CustomObjectKeyConstructor(DefaultKeyConstructor):
    retrieve_sql = RetrieveSqlQueryKeyBit()
    updated_at = UpdatedAtKeyBit()


class CustomListKeyConstructor(DefaultKeyConstructor):
    list_sql = ListSqlQueryKeyBit()
    pagination = PaginationKeyBit()
    updated_at = UpdatedAtKeyBit()
