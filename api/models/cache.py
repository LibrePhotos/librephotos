from datetime import datetime

from django.core.cache import cache
from django.db.models.signals import post_delete, post_save

from api.models.album_auto import AlbumAuto
from api.models.album_date import AlbumDate
from api.models.album_place import AlbumPlace
from api.models.album_thing import AlbumThing
from api.models.album_user import AlbumUser
from api.models.face import Face
from api.models.person import Person
from api.models.photo import Photo


def change_api_updated_at(sender=None, instance=None, *args, **kwargs):
    cache.set("api_updated_at_timestamp", datetime.utcnow())


# for cache invalidation. invalidates all cache on modelviewsets on delete and save on any model
for model in [
    Photo,
    Person,
    Face,
    AlbumDate,
    AlbumAuto,
    AlbumUser,
    AlbumPlace,
    AlbumThing,
]:
    post_save.connect(receiver=change_api_updated_at, sender=model)
    post_delete.connect(receiver=change_api_updated_at, sender=model)
