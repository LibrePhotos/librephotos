import serpy
from constance import config as site_config

from api.util import logger
from api.views.PhotosGroupedByDate import get_photos_ordered_by_date


# Serpy is used, because it is way faster when serializing than the django restframework
class DateTimeField(serpy.Field):
    def to_value(self, value):
        try:
            if value:
                return value.isoformat()
            else:
                return None
        except:
            # import pdb; pdb.set_trace()
            logger.warning("DateTimefield error")


class SimpleUserSerializer(serpy.Serializer):
    id = serpy.IntField()
    username = serpy.StrField()
    first_name = serpy.StrField()
    last_name = serpy.StrField()


class SharedPhotoSuperSimpleSerializer(serpy.Serializer):
    image_hash = serpy.StrField()
    rating = serpy.IntField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    video = serpy.BoolField()
    exif_timestamp = DateTimeField()
    owner = SimpleUserSerializer()
    shared_to = SimpleUserSerializer(many=True, call=True, attr="shared_to.all")


class PhotoSuperSimpleSerializer(serpy.Serializer):
    image_hash = serpy.StrField()
    rating = serpy.IntField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    video = serpy.BoolField()
    exif_timestamp = DateTimeField()
    allow_null = False


class PhotoSuperSimpleSerializerWithAddedOn(serpy.Serializer):
    image_hash = serpy.StrField()
    rating = serpy.IntField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    video = serpy.BoolField()
    exif_timestamp = DateTimeField()
    added_on = DateTimeField()


class PigPhotoSerilizer(serpy.Serializer):
    id = serpy.StrField(attr="image_hash")
    dominantColor = serpy.StrField(attr="image_hash")  # To-Do
    url = serpy.StrField(attr="image_hash")
    location = serpy.StrField(attr="search_location")
    date = DateTimeField(attr="exif_timestamp")
    birthTime = serpy.StrField(attr="exif_timestamp")
    aspectRatio = serpy.FloatField(attr="aspect_ratio")
    type = serpy.MethodField("get_type")
    rating = serpy.IntField("rating")

    def get_type(self, obj):
        if obj.video:
            return "video"
        else:
            return "image"


class GroupedPhotosSerializer(serpy.Serializer):
    date = serpy.StrField()
    location = serpy.StrField()
    items = PigPhotoSerilizer(many=True, attr="photos")


class GroupedPersonPhotosSerializer(serpy.Serializer):
    id = serpy.StrField()
    name = serpy.StrField()
    grouped_photos = serpy.MethodField("get_photos")

    def get_photos(self, obj):
        user = None
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user
        grouped_photos = get_photos_ordered_by_date(obj.get_photos(user))
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
        return res


class GroupedPlacePhotosSerializer(serpy.Serializer):
    id = serpy.StrField()
    title = serpy.StrField()
    grouped_photos = serpy.MethodField("get_photos")

    def get_photos(self, obj):
        grouped_photos = get_photos_ordered_by_date(obj.photos.all())
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
        return res


class PigAlbumDateSerializer(serpy.Serializer):
    date = DateTimeField()
    location = serpy.MethodField("get_location")
    items = PigPhotoSerilizer(many=True, call=True, attr="photos.all")

    def get_location(self, obj):
        if obj and obj.location:
            return obj.location["places"][0]
        else:
            return ""


class AlbumUserSerializerSerpy(serpy.Serializer):
    id = serpy.StrField()
    title = serpy.StrField()
    owner = SimpleUserSerializer()
    shared_to = SimpleUserSerializer(many=True, call=True, attr="shared_to.all")
    date = serpy.MethodField("get_date")
    location = serpy.MethodField("get_location")
    grouped_photos = serpy.MethodField("get_photos")

    def get_photos(self, obj):
        grouped_photos = get_photos_ordered_by_date(
            obj.photos.all().order_by("-exif_timestamp")
        )
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
        return res

    def get_location(self, obj):
        for photo in obj.photos.all():
            if photo and photo.search_location:
                return photo.search_location
        return ""

    def get_date(self, obj):
        for photo in obj.photos.all():
            if photo and photo.exif_timestamp:
                return photo.exif_timestamp
        else:
            return ""


class AlbumDateListWithPhotoHashSerializer(serpy.Serializer):
    photos = PhotoSuperSimpleSerializer(many=True, call=True, attr="photos.all")
    location = serpy.Field()
    id = serpy.IntField()
    date = DateTimeField()
    allow_null = False


# todo
class AlbumPersonSerializer(serpy.Serializer):
    name = serpy.StrField()
    id = serpy.IntField()
    # photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='photos.all')
