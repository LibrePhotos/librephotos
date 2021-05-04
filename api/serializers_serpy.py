import serpy


class DateTimeField(serpy.Field):
    def to_value(self, value):
        try:
            if value:
                return value.isoformat()
            else:
                return None
        except:
            #import pdb; pdb.set_trace()
            logger.warning("DateTimefield error")


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
    allow_null = False


class PhotoSuperSimpleSerializerWithAddedOn(serpy.Serializer):
    image_hash = serpy.StrField()
    favorited = serpy.BoolField()
    public = serpy.BoolField()
    hidden = serpy.BoolField()
    exif_timestamp = DateTimeField()
    added_on = DateTimeField()


class AlbumDateListWithPhotoHashSerializer(serpy.Serializer):
    photos = PhotoSuperSimpleSerializer(
        many=True, call=True, attr='photos.all')
    location = serpy.Field()
    id = serpy.IntField()
    date = DateTimeField()
    allow_null = False


# todo
class AlbumPersonSerializer(serpy.Serializer):
    name = serpy.StrField()
    id = serpy.IntField()
    # photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='photos.all')
