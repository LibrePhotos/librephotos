from datetime import datetime

import PIL
from PIL import ImageOps
from PIL.ExifTags import TAGS as EXIFTAGS

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
import pytz
import json

from io import BytesIO
from django.core.files.base import ContentFile

from geopy.geocoders import Nominatim

from django.db.models.signals import post_save, post_delete
from django.core.cache import cache
from django.contrib.postgres.fields import JSONField


import requests
import base64
from io import StringIO




geolocator = Nominatim()
default_tz = pytz.timezone('Asia/Seoul')


def change_api_updated_at(sender=None, instance=None, *args, **kwargs):
    cache.set('api_updated_at_timestamp', datetime.utcnow())

def get_album_date(date):
    return AlbumDate.objects.get_or_create(date=date)

class Photo(models.Model):
    image_path = models.FilePathField()
    image_hash = models.CharField(primary_key=True,max_length=32,null=False)

    thumbnail = models.ImageField(upload_to='thumbnails')
    square_thumbnail = models.ImageField(upload_to='square_thumbnails')
    image = models.ImageField(upload_to='photos')
    
    added_on = models.DateTimeField(null=False,blank=False,db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True,null=True,db_index=True)
	exif_orientation = models.TextField(blank=true, null=True,db_index=False)

    exif_json = JSONField(blank=True,null=True)

    geolocation_json = JSONField(blank=True,null=True,db_index=True)

    search_captions = models.TextField(blank=True,null=True,db_index=True)
    search_location = models.TextField(blank=True,null=True,db_index=True)
    
    favorited = models.BooleanField(default=False,db_index=True)

    def _generate_md5(self):
        hash_md5 = hashlib.md5()
        with open(self.image_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        self.image_hash = hash_md5.hexdigest()

    def _generate_captions(self):
        try:
            thumbnail_path = self.thumbnail.url
            with open("."+thumbnail_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read())
            encoded_string = str(encoded_string)[2:-1]
            resp_captions = requests.post('http://localhost:5000/',data=encoded_string)
            self.search_captions = ' , '.join(resp_captions.json()['data'][:10])
        except:
            pass

    def _generate_thumbnail(self):
        image = PIL.Image.open(self.image_path)
		
		#If no ExifTags, no rotating needed.
		try:
			# Grab orientation value.
			image_exif = image._getexif()
			image_orientation = image_exif[274]

			# Rotate depending on orientation.
			if image_orientation == 2:
				image = image.transpose(PIL.Image.FLIP_LEFT_RIGHT)
			if image_orientation == 3:
				image = image.transpose(PIL.Image.ROTATE_180)
			if image_orientation == 4:
				image = image.transpose(PIL.Image.FLIP_TOP_BOTTOM)
			if image_orientation == 5:
				image = image.transpose(PIL.Image.FLIP_LEFT_RIGHT).transpose(PIL.Image.ROTATE_90)
			if image_orientation == 6:
				image = image.transpose(PIL.Image.ROTATE_270)
			if image_orientation == 7:
				image = image.transpose(PIL.Image.FLIP_TOP_BOTTOM).transpose(PIL.Image.ROTATE_90)
			if image_orientation == 8:
				image = image.transpose(PIL.Image.ROTATE_90)
		
		except:
			pass
				
        # make aspect ration preserved thumbnail
        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE, PIL.Image.ANTIALIAS)
        image_io_thumb = BytesIO()
        image.save(image_io_thumb,format="JPEG")
        self.thumbnail.save(self.image_hash+'.jpg', ContentFile(image_io_thumb.getvalue()))
        image_io_thumb.close()
		
        # make square thumbnail
        square_thumb = ImageOps.fit(image, ownphotos.settings.THUMBNAIL_SIZE, PIL.Image.ANTIALIAS)
        image_io_square_thumb = BytesIO()
        square_thumb.save(image_io_square_thumb,format="JPEG")
        self.square_thumbnail.save(self.image_hash+'.jpg', ContentFile(image_io_square_thumb.getvalue()))
        image_io_square_thumb.close()

    def _save_image_to_db(self):
        image = PIL.Image.open(self.image_path)
        # image.thumbnail(ownphotos.settings.FULLPHOTO_SIZE, PIL.Image.ANTIALIAS)
        image_io = BytesIO()
        image.save(image_io,format="JPEG")
        self.image.save(self.image_hash+'.jpg', ContentFile(image_io.getvalue()))
        image_io.close()

    def _extract_exif(self):
        ret = {}
        # ipdb.set_trace()
        i = PIL.Image.open(self.image_path)
        info = i._getexif()
        for tag, value in info.items():
            decoded = EXIFTAGS.get(tag,tag)
            ret[decoded] = value


        with open(self.image_path,'rb') as fimg:
            exif = exifread.process_file(fimg,details=False)

            serializable = dict([key,value.printable] for key,value in exif.items())
            self.exif_json = serializable
            # ipdb.set_trace()
            if 'EXIF DateTimeOriginal' in exif.keys():
                tst_str = exif['EXIF DateTimeOriginal'].values
                try:
                    tst_dt = datetime.strptime(tst_str,"%Y:%m:%d %H:%M:%S") 
                except:
                    tst_dt = datetime.strptime(tst_str,"%Y-%m-%d %H:%M:%S")                     
                # ipdb.set_trace()
                self.exif_timestamp = tst_dt
            else:
                self.exif_timestamp = None
				
			if 'EXIF Orientation' in exif.keys():
                ornt_str = exif['EXIF Orientation'].values
                self.exif_orientation = ornt_str
            else:
                self.exif_orientation = None

            if 'GPS GPSLongitude' in exif.keys():
                self.exif_gps_lon = util.convert_to_degrees(exif['GPS GPSLongitude'].values)
                # Check for correct positive/negative degrees
                if exif['GPS GPSLongitudeRef'].values != 'E':
                    self.exif_gps_lon = -self.exif_gps_lon
            else:
                self.exif_gps_lon = None

            if 'GPS GPSLatitude' in exif.keys():
                self.exif_gps_lat = util.convert_to_degrees(exif['GPS GPSLatitude'].values)
                # Check for correct positive/negative degrees
                if exif['GPS GPSLatitudeRef'].values != 'N':
                    self.exif_gps_lat = -self.exif_gps_lat
            else:
                self.exif_gps_lat = None

    def _geolocate(self):
        if not (self.exif_gps_lat and self.exif_gps_lon):
            self._extract_exif()
        if (self.exif_gps_lat and self.exif_gps_lon):
            try:
                location = geolocator.reverse("%f,%f"%(self.exif_gps_lat,self.exif_gps_lon))
                location = location.raw
                self.geolocation_json = location
                self.save()
            except:
                pass
                # self.geolocation_json = {}



    def _geolocate_mapzen(self):
        if not (self.exif_gps_lat and self.exif_gps_lon):
            self._extract_exif()
        if (self.exif_gps_lat and self.exif_gps_lon):
            try:
                res = util.mapzen_reverse_geocode(self.exif_gps_lat,self.exif_gps_lon)
                self.geolocation_json = res
                if 'search_text' in res.keys():
                    if self.search_location:
                        self.search_location = self.search_location + ' ' + res['search_text']
                    else:
                        self.search_location = res['search_text']
                self.save()
            except:
                pass
                # self.geolocation_json = {}




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

    def _add_to_album_date(self):
        if self.exif_timestamp:
            album_date = get_album_date(date=self.exif_timestamp.date())[0]
            album_date.photos.add(self)
            album_date.save()

    def __str__(self):
        return "%s"%self.image_hash


class Person(models.Model):
    KIND_CHOICES = (
        ('USER', 'User Labelled'),
        ('CLUSTER', 'Cluster ID'),
        ('UNKNOWN', 'Unknown Person'))
    name = models.CharField(blank=False,max_length=128)
    kind = models.CharField(choices=KIND_CHOICES,max_length=10)
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)

    def __str__(self):
        return "%d"%self.id

    def _update_average_face_encoding(self):
        encodings = []
        faces = self.faces.all()
        for face in faces:
            r = base64.b64decode(face.encoding)
            encoding = np.frombuffer(r,dtype=np.float64)
            encodings.append(encoding)
        mean_encoding = np.array(encodings).mean(axis=0)
        self.mean_face_encoding = base64.encodebytes(mean_encoding.tostring())
        # ipdb.set_trace()
        


def get_unknown_person():
    return Person.objects.get_or_create(name='unknown',kind="UNKNOWN")

class Face(models.Model):
    photo = models.ForeignKey(Photo, related_name='faces', blank=False, null=False)
    image = models.ImageField(upload_to='faces')
    image_path = models.FilePathField()
    
    person = models.ForeignKey(Person, on_delete=models.SET(get_unknown_person), related_name='faces')
    person_label_is_inferred = models.NullBooleanField(db_index=True)

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()

    encoding = models.TextField()

    def __str__(self):
        return "%d"%self.id



class AlbumDate(models.Model):
    title = models.CharField(blank=True,null=True,max_length=512,db_index=True)
    date = models.DateField(unique=True,db_index=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False,db_index=True)

    def __str__(self):
        return "%d: %s"%(self.id, self.title)

class AlbumAuto(models.Model):
    title = models.CharField(blank=True,null=True,max_length=512)
    timestamp = models.DateTimeField(unique=True,db_index=True)
    created_on = models.DateTimeField(auto_now=False,db_index=True)
    gps_lat = models.FloatField(blank=True,null=True)
    gps_lon = models.FloatField(blank=True,null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False,db_index=True)

    def _autotitle(self):
        weekday = ""
        time = ""
        loc = ""
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
            loc = "in SomeCity"
            try:
                location = geolocator.reverse("%f,%f"%(self.gps_lat,self.gps_lon))
                location = location.raw
                address = location['address']
                if 'city' in address.keys():
                    loc = 'in ' + address['city']
                if 'town' in address.keys():
                    loc = 'in ' + address['town']
                if 'village' in address.keys():
                    loc = 'in ' + address['village']
            except:
                loc = ''

        title = ' '.join([weekday,time,loc]).strip()
        self.title = title

    def __str__(self):
        return "%d: %s"%(self.id, self.title)

class AlbumUser(models.Model):
    title = models.CharField(blank=True,null=True,max_length=512)
    timestamp = models.DateTimeField(unique=True,db_index=True)
    created_on = models.DateTimeField(auto_now=True,db_index=True)
    gps_lat = models.FloatField(blank=True,null=True)
    gps_lon = models.FloatField(blank=True,null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False,db_index=True)


for model in [Photo, Person, Face, AlbumDate, AlbumAuto, AlbumUser]:
    post_save.connect(receiver=change_api_updated_at, sender=model)
    post_delete.connect(receiver=change_api_updated_at, sender=model)