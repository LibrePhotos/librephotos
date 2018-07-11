import ipdb
import serpy


class DateTimeField(serpy.Field):
    def to_value(self, value):
        try:
            if value:
                return value.isoformat()
            else:
                return None
        except:
            ipdb.set_trace()


class SimpleUserSerializer(serpy.Serializer):
    id = serpy.IntField()
    username = serpy.StrField()
    first_name = serpy.StrField()
    last_name = serpy.StrField()


# 'image_hash', 'favorited', 'hidden', 'exif_timestamp','public', 'owner', 'shared_to'
class SharedPhotoSuperSimpleSerializer(serpy.Serializer):
    image_hash = serpy.StrField()
    favorited = serpy.BoolField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    exif_timestamp = DateTimeField()
    owner = SimpleUserSerializer()
    shared_to = SimpleUserSerializer(
        many=True, call=True, attr='shared_to.all')


class PhotoSuperSimpleSerializer(serpy.Serializer):
    image_hash = serpy.StrField()
    favorited = serpy.BoolField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    exif_timestamp = DateTimeField()
    # shared_to_count = serpy.IntField()


class PhotoSuperSimpleSerializerWithAddedOn(serpy.Serializer):
    image_hash = serpy.StrField()
    favorited = serpy.BoolField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    exif_timestamp = DateTimeField()
    added_on = DateTimeField()


class AlbumDateListWithPhotoHashSerializer(serpy.Serializer):
    #     photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='ordered_photos')
    photos = PhotoSuperSimpleSerializer(
        many=True, call=True, attr='photos.all')
    location = serpy.Field()
    id = serpy.IntField()
    date = DateTimeField()


# todo
class AlbumPersonSerializer(serpy.Serializer):
    name = serpy.StrField()
    id = serpy.IntField()
    # photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='photos.all')