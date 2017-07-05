from datetime import datetime
import PIL
from django.db import models
import face_recognition
import hashlib
import ownphotos.settings
import api.util as util
import exifread
import base64
import numpy as np
import ipdb
import os

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

    def _generate_thumbnail(self):
        image = PIL.Image.open(self.image_path)
        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE, PIL.Image.ANTIALIAS)
        image_io = BytesIO()
        image.save(image_io,format="JPEG")
        self.thumbnail.save(self.image_hash+'.jpg', ContentFile(image_io.getvalue()))
        image_io.close()


    def _extract_exif(self):
        with open(self.image_path,'rb') as fimg:
            exif = exifread.process_file(fimg,details=False)

            if 'EXIF DateTimeOriginal' in exif.keys():
                tst_str = exif['EXIF DateTimeOriginal'].values
                try:
                    tst_dt = datetime.strptime(tst_str,"%Y:%m:%d %H:%M:%S") 
                except:
                    tst_dt = datetime.strptime(tst_str,"%Y-%m-%d %H:%M:%S")                     
                self.exif_timestamp = tst_dt
            else:
                self.exif_timestamp = None

            if 'GPS GPSLongitude' in exif.keys():
                self.exif_gps_lon = util.convert_to_degrees(exif['GPS GPSLongitude'].values)
            else:
                self.exif_gps_lon = None

            if 'GPS GPSLatitude' in exif.keys():
                self.exif_gps_lat = util.convert_to_degrees(exif['GPS GPSLatitude'].values)
            else:
                self.exif_gps_lat = None

    def _extract_faces(self):
        qs_unknown_person = Person.objects.filter(name='unknown')
        if qs_unknown_person.count() == 0:
            unknown_person = Person(name='unknown')
            unknown_person.save()
        else:
            unknown_person = qs_unknown_person[0]

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
                face.image_path = self.image_hash+"_"+str(idx_face)+'.jpg'
                face.person = unknown_person
                face.photo = self
                face.location_top = face_location[0]
                face.location_right = face_location[1]
                face.location_bottom = face_location[2]
                face.location_left = face_location[3]
                face.encoding = base64.encodebytes(face_encoding.tostring())

                face_io = BytesIO()
                face_image.save(face_io,format="JPEG")
                face.image.save(face.image_path, ContentFile(face_io.getvalue()))
                face_io.close()
                face.save()

    def __str__(self):
        return "%s"%self.image_hash


class Person(models.Model):
    name = models.CharField(blank=False,max_length=128)

    def __str__(self):
        return "%d"%self.id

def get_unknown_person():
    return Person.objects.get_or_create(name='unknown')

class Face(models.Model):
    photo = models.ForeignKey(Photo, related_name='faces', blank=False, null=False)
    image = models.ImageField(upload_to='faces')
    image_path = models.FilePathField()
    
    person = models.ForeignKey(Person, on_delete=models.SET(get_unknown_person), related_name='faces')
    person_label_is_inferred = models.NullBooleanField()

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()

    encoding = models.TextField()

    def __str__(self):
        return "%d"%self.id

class AlbumAuto(models.Model):
    title = models.CharField(blank=True,null=True,max_length=512)
    timestamp = models.DateTimeField(unique=True)
    created_on = models.DateTimeField(auto_now=True)
    gps_lat = models.FloatField(blank=True,null=True)
    gps_lon = models.FloatField(blank=True,null=True)
    photos = models.ManyToManyField(Photo)

    def _autotitle(self):
        weekday = ""
        time = ""
        location = ""
        if self.timestamp:
            weekday = util.weekdays[self.timestamp.isoweekday()]
            hour = self.timestamp.hour
            if hour > 0 and hour < 5:
                time = "Early Morning"
            elif hour >= 5 and hour < 12:
                time = "Morning"
            elif hour >= 12 and hour < 18:
                time = "Afternoon"
            elif hour >= 18 and hour <=24:
                time = "Evening"
        if self.gps_lat and self.gps_lon:
            location = "in SomeCity"
        title = ' '.join([weekday,time,location]).strip()
        self.title = title

    def __str__(self):
        return "%d: %s"%(self.id, self.title)

class AlbumUser(models.Model):
    title = models.CharField(blank=True,null=True,max_length=512)
    timestamp = models.DateTimeField(unique=True)
    created_on = models.DateTimeField(auto_now=True)
    gps_lat = models.FloatField(blank=True,null=True)
    gps_lon = models.FloatField(blank=True,null=True)
    photos = models.ManyToManyField(Photo)
