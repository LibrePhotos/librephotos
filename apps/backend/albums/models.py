from datetime import datetime
import PIL
import face_recognition
from django.db import models
import face_recognition
import hashlib
import ownphotos.settings
import albums.util as util
import exifread
import base64
import numpy as np
import ipdb

from io import BytesIO
from django.core.files.base import ContentFile

class Photo(models.Model):
    image_path = models.FilePathField()
    thumbnail = models.ImageField(upload_to='thumbnails')
    image_hash = models.CharField(primary_key=True,max_length=32,null=False)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True,null=True)

    def _generate_md5(self):
        hash_md5 = hashlib.md5()
        with open(self.image_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        self.image_hash = hash_md5.hexdigest()

    def _generate_thumbnail(self):#fname_in,fname_out,thumbnails_path):
        image = PIL.Image.open(self.image_path)
        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE, PIL.Image.ANTIALIAS)
#         self.thumbnail = image
        image_io = BytesIO()
        image.save(image_io,format="JPEG")
        self.thumbnail.save(self.image_hash, ContentFile(image_io.getvalue()))
        image_io.close()


    def _extract_exif(self):
        with open(self.image_path,'rb') as fimg:
            exif = exifread.process_file(fimg,details=False)

            if 'EXIF DateTimeOriginal' in exif.keys():
                tst_str = exif['EXIF DateTimeOriginal'].values
                tst_dt = datetime.strptime(tst_str,"%Y:%m:%d %H:%M:%S") 
                self.exif_timestamp = tst_dt
            else:
                self.exif_timestamp = None

            if 'GPS GPSLongitude' in exif.keys():
                self.exif_gps_lat = util.convert_to_degrees(exif['GPS GPSLongitude'].values)
            else:
                self.exif_gps_lat = None

            if 'GPS GPSLatitude' in exif.keys():
                self.exif_gps_lat = util.convert_to_degrees(exif['GPS GPSLongitude'].values)
            else:
                self.exif_gps_lat = None

    def _extract_faces(self):
        thumbnail = PIL.Image.open(self.thumbnail)
        thumbnail = np.array(thumbnail.convert('RGB'))

        face_encodings = face_recognition.face_encodings(thumbnail)
        face_locations = face_recognition.face_locations(thumbnail)
    
        faces = []
        if len(face_locations) > 0:
            for idx_face, face in enumerate(zip(face_encodings,face_locations)):
                face_encoding = face[0]
                face_location = face[1]
                top,right,bottom,left = face_location
                face_image = thumbnail[top:bottom, left:right]
                face_image = PIL.Image.fromarray(face_image)

                face = Face()
                face.photo = self
                face.location_top = face_location[0]
                face.location_right = face_location[1]
                face.location_bottom = face_location[2]
                face.location_left = face_location[3]
                face.encoding = base64.encodebytes(face_encoding.tostring())

                face_io = BytesIO()
                face_image.save(face_io,format="JPEG")
                face.image.save(self.image_hash+str(idx_face), ContentFile(face_io.getvalue()))
                face_io.close()



#                 face = {}
#                 face['location'] = face_location
#                 face['encoding'] = face_encoding
#                 face['face_img'] = face_image
# 
#                 faces.append(face)
class Person(models.Model):
    name = models.CharField(blank=True,max_length=128)

class Face(models.Model):
    photo = models.ForeignKey(Photo, blank=False, null=False)
    image = models.ImageField(blank=True, null=True)


    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()

    encoding = models.TextField()



