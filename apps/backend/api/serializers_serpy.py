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

class PhotoSuperSimpleSerializer(serpy.Serializer):
    image_hash = serpy.StrField()
    favorited = serpy.BoolField()
    hidden = serpy.BoolField()
    exif_timestamp = DateTimeField()



class AlbumDateListWithPhotoHashSerializer(serpy.Serializer):
#     photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='ordered_photos')
    photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='photos.all')
    location = serpy.Field()
    id = serpy.IntField()
    date = DateTimeField()


# todo
class AlbumPersonSerializer(serpy.Serializer):
    name = serpy.StrField()
    id = serpy.IntField()
    # photos = PhotoSuperSimpleSerializer(many=True, call=True, attr='photos.all')