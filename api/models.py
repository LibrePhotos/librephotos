from datetime import datetime
import dateutil.parser as dateparser
import PIL
from PIL import ImageOps
from PIL.ExifTags import TAGS as EXIFTAGS
from django.db import models
from django.db.models import Prefetch
import face_recognition
import hashlib
import ownphotos.settings
import api.util as util
from api.util import logger
import exifread
import base64
import numpy as np
import os
import pytz
import json

from collections import Counter
from io import BytesIO
from django.core.files.base import ContentFile

from geopy.geocoders import Nominatim

from django.db.models.signals import post_save, post_delete
from django.core.cache import cache
from django.contrib.postgres.fields import JSONField

from api.places365.places365 import inference_places365
from api.im2txt.sample import im2txt

import requests
import base64
from io import StringIO

import ipdb


geolocator = Nominatim()
default_tz = pytz.timezone('Asia/Seoul')


def change_api_updated_at(sender=None, instance=None, *args, **kwargs):
    cache.set('api_updated_at_timestamp', datetime.utcnow())

def get_album_date(date):
    return AlbumDate.objects.get_or_create(date=date)

def get_album_thing(title):
    return AlbumThing.objects.get_or_create(title=title)

def get_album_place(title):
    return AlbumPlace.objects.get_or_create(title=title)

def get_album_nodate():
    return AlbumDate.objects.get_or_create(date=None)

def get_or_create_person(name):
    qs = Person.objects.filter(name=name)
    if qs.count() > 0:
        return qs[0]
    else:
        new_person = Person()
        new_person.name = name
        new_person.save()
        return new_person


class Photo(models.Model):
    image_path = models.FilePathField(max_length=512, db_index=True)
    image_hash = models.CharField(primary_key=True,max_length=32,null=False)

    thumbnail = models.ImageField(upload_to='thumbnails')
    thumbnail_tiny = models.ImageField(upload_to='thumbnails_tiny')
    thumbnail_small = models.ImageField(upload_to='thumbnails_small')
    thumbnail_big = models.ImageField(upload_to='thumbnails_big')

    square_thumbnail = models.ImageField(upload_to='square_thumbnails')
    square_thumbnail_tiny = models.ImageField(upload_to='square_thumbnails_tiny')
    square_thumbnail_small = models.ImageField(upload_to='square_thumbnails_small')
    square_thumbnail_big = models.ImageField(upload_to='square_thumbnails_big')



    image = models.ImageField(upload_to='photos')
    
    added_on = models.DateTimeField(null=False,blank=False,db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True,null=True,db_index=True)

    exif_json = JSONField(blank=True,null=True)

    geolocation_json = JSONField(blank=True,null=True,db_index=True)
    captions_json =  JSONField(blank=True,null=True,db_index=True)

    search_captions = models.TextField(blank=True,null=True,db_index=True)
    search_location = models.TextField(blank=True,null=True,db_index=True)

    favorited = models.BooleanField(default=False,db_index=True)
    hidden = models.BooleanField(default=False,db_index=True)

    def _generate_md5(self):
        hash_md5 = hashlib.md5()
        with open(self.image_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        self.image_hash = hash_md5.hexdigest()

    def _generate_captions(self):
        image_path = self.thumbnail.path
        captions = {}

        '''
        try:
            caption = im2txt(image_path)
            caption = caption.replace("<start>",'').replace("<end>",'').strip().lower()
            captions['im2txt'] = caption
            self.captions_json = captions
            self.search_captions = caption
            self.save()
            util.logger.info('generated im2txt captions for image %s. caption: %s'%(image_path,caption))
        except:
            util.logger.warning('could not generate im2txt captions for image %s'%image_path)
        '''


        # densecap
        try:
            with open(image_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read())
            encoded_string = str(encoded_string)[2:-1]
            resp_captions = requests.post('http://localhost:5000/',data=encoded_string)
            captions['densecap'] = resp_captions.json()['data'][:10]
            self.search_captions = ' , '.join(resp_captions.json()['data'][:10])
            self.save()
        except:
            util.logger.warning('could not generate densecap captions for image %s'%image_path)

        # places365
        try:
            res_places365 = inference_places365(image_path)
            captions['places365'] = res_places365
            self.captions_json = captions
            if self.search_captions:
                self.search_captions = self.search_captions + ' , ' + \
                    ' , '.join(res_places365['attributes'] + res_places365['categories'] + [res_places365['environment']])
            else:
                self.search_captions = ' , '.join(res_places365['attributes'] + res_places365['categories'] + [res_places365['environment']])

            self.save()
            util.logger.info('generated places365 captions for image %s.'%(image_path))
        except:
            util.logger.warning('could not generate places365 captions for image %s'%image_path)

    def _generate_thumbnail(self):
        image = PIL.Image.open(self.image_path)

        # If no ExifTags, no rotating needed.
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

        # make thumbnails
        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE_BIG, PIL.Image.ANTIALIAS)
        image_io_thumb = BytesIO()
        image.save(image_io_thumb,format="JPEG")
        self.thumbnail_big.save(self.image_hash+'.jpg', ContentFile(image_io_thumb.getvalue()))
        image_io_thumb.close()

        square_thumb = ImageOps.fit(image, ownphotos.settings.THUMBNAIL_SIZE_BIG, PIL.Image.ANTIALIAS)
        image_io_square_thumb = BytesIO()
        square_thumb.save(image_io_square_thumb,format="JPEG")
        self.square_thumbnail_big.save(self.image_hash+'.jpg', ContentFile(image_io_square_thumb.getvalue()))
        image_io_square_thumb.close()



        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE_MEDIUM, PIL.Image.ANTIALIAS)
        image_io_thumb = BytesIO()
        image.save(image_io_thumb,format="JPEG")
        self.thumbnail.save(self.image_hash+'.jpg', ContentFile(image_io_thumb.getvalue()))
        image_io_thumb.close()

        square_thumb = ImageOps.fit(image, ownphotos.settings.THUMBNAIL_SIZE_MEDIUM, PIL.Image.ANTIALIAS)
        image_io_square_thumb = BytesIO()
        square_thumb.save(image_io_square_thumb,format="JPEG")
        self.square_thumbnail.save(self.image_hash+'.jpg', ContentFile(image_io_square_thumb.getvalue()))
        image_io_square_thumb.close()



        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE_SMALL, PIL.Image.ANTIALIAS)
        image_io_thumb = BytesIO()
        image.save(image_io_thumb,format="JPEG")
        self.thumbnail_small.save(self.image_hash+'.jpg', ContentFile(image_io_thumb.getvalue()))
        image_io_thumb.close()

        square_thumb = ImageOps.fit(image, ownphotos.settings.THUMBNAIL_SIZE_SMALL, PIL.Image.ANTIALIAS)
        image_io_square_thumb = BytesIO()
        square_thumb.save(image_io_square_thumb,format="JPEG")
        self.square_thumbnail_small.save(self.image_hash+'.jpg', ContentFile(image_io_square_thumb.getvalue()))
        image_io_square_thumb.close()



        image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE_TINY, PIL.Image.ANTIALIAS)
        image_io_thumb = BytesIO()
        image.save(image_io_thumb,format="JPEG")
        self.thumbnail_tiny.save(self.image_hash+'.jpg', ContentFile(image_io_thumb.getvalue()))
        image_io_thumb.close()

        square_thumb = ImageOps.fit(image, ownphotos.settings.THUMBNAIL_SIZE_TINY, PIL.Image.ANTIALIAS)
        image_io_square_thumb = BytesIO()
        square_thumb.save(image_io_square_thumb,format="JPEG")
        self.square_thumbnail_tiny.save(self.image_hash+'.jpg', ContentFile(image_io_square_thumb.getvalue()))
        image_io_square_thumb.close()






    def _save_image_to_db(self):
        image = PIL.Image.open(self.image_path)


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
        date_format = "%Y:%m:%d %H:%M:%S"
        if info:
            for tag, value in info.items():
                decoded = EXIFTAGS.get(tag, tag)
                ret[decoded] = value

            with open(self.image_path, 'rb') as fimg:
                exif = exifread.process_file(fimg, details=False)

                serializable = dict([key, value.printable] for key, value in exif.items())
                self.exif_json = serializable
                # ipdb.set_trace()
                if 'EXIF DateTimeOriginal' in exif.keys():
                    tst_str = exif['EXIF DateTimeOriginal'].values
                    try:
                        tst_dt = datetime.strptime(tst_str, date_format)
                    except:
                        tst_dt = None
                    # ipdb.set_trace()
                    self.exif_timestamp = tst_dt
                else:
                    self.exif_timestamp = None

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

        if not self.exif_timestamp:
            try:
                basename_without_extension = os.path.basename(self.image_path)
                self.exif_timestamp = dateparser.parse(basename_without_extension, ignoretz=True, fuzzy=True)
            except BaseException:
                util.logger.warning("Failed to determine date from filename for image %s"%self.image_path)

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



    def _geolocate_mapbox(self):
        if not (self.exif_gps_lat and self.exif_gps_lon):
            self._extract_exif()
        if (self.exif_gps_lat and self.exif_gps_lon):
            try:
                res = util.mapbox_reverse_geocode(self.exif_gps_lat,self.exif_gps_lon)
                self.geolocation_json = res
                if 'search_text' in res.keys():
                    if self.search_location:
                        self.search_location = self.search_location + ' ' + res['search_text']
                    else:
                        self.search_location = res['search_text']
                self.save()
            except:
                util.logger.warning('something went wrong with geolocating')
                pass
                # self.geolocation_json = {}




    def _extract_faces(self):
        qs_unknown_person = Person.objects.filter(name='unknown')
        if qs_unknown_person.count() == 0:
            unknown_person = Person(name='unknown')
            unknown_person.save()
        else:
            unknown_person = qs_unknown_person[0]

        image = PIL.Image.open(self.thumbnail)
        image = np.array(image.convert('RGB'))

        face_encodings = face_recognition.face_encodings(image)
        face_locations = face_recognition.face_locations(image)
    
        faces = []
        if len(face_locations) > 0:
            for idx_face, face in enumerate(zip(face_encodings,face_locations)):
                face_encoding = face[0]
                face_location = face[1]
                top,right,bottom,left = face_location
                face_image = image[top:bottom, left:right]
                face_image = PIL.Image.fromarray(face_image)

                face = Face()
                face.image_path = self.image_hash+"_"+str(idx_face)+'.jpg'
                face.person = unknown_person
                face.photo = self
                face.location_top = face_location[0]
                face.location_right = face_location[1]
                face.location_bottom = face_location[2]
                face.location_left = face_location[3]
                face.encoding = face_encoding.tobytes().hex()
#                 face.encoding = face_encoding.dumps()

                face_io = BytesIO()
                face_image.save(face_io,format="JPEG")
                face.image.save(face.image_path, ContentFile(face_io.getvalue()))
                face_io.close()
                face.save()

    def _add_to_album_thing(self):
        if type(self.captions_json) is dict and 'places365' in self.captions_json.keys():
            for attribute in self.captions_json['places365']['attributes']:
                album_thing = get_album_thing(title=attribute)[0]
                if album_thing.photos.filter(image_hash=self.image_hash).count() == 0:
                    album_thing.photos.add(self)
                    album_thing.thing_type='places365_attribute'
                    if album_thing.cover_photos.count() < 4:
                        album_thing.cover_photos.add(self)
                    album_thing.save()
            for category in self.captions_json['places365']['categories']:
                album_thing = get_album_thing(title=category)[0]
                if album_thing.photos.filter(image_hash=self.image_hash).count() == 0:
                    album_thing = get_album_thing(title=category)[0]
                    album_thing.photos.add(self)
                    album_thing.thing_type='places365_category'
                    if album_thing.cover_photos.count() < 4:
                        album_thing.cover_photos.add(self)
                    album_thing.save()



        # if self.search_captions:
        #     doc = util.nlp('. '.join(self.search_captions.split(' , ')))
        #     nouns = list(set([t.lemma_ for t in doc if t.tag_=="NN"]))
        #     for noun in nouns:
        #         album_thing = get_album_thing(title=noun)[0]
        #         album_thing.photos.add(self)
        #         album_thing.save()

    def _add_to_album_date(self):
        if self.exif_timestamp:
            album_date = get_album_date(date=self.exif_timestamp.date())[0]
            album_date.photos.add(self)
        else:
            album_date = get_album_date(date=None)[0]
            album_date.photos.add(self)

        if self.geolocation_json and len(self.geolocation_json) > 0:
            city_name = [f['text'] for f in self.geolocation_json['features'][1:-1] if not f['text'].isdigit()][0]
            if album_date.location and len(album_date.location) > 0:
                prev_value = album_date.location
                new_value = prev_value
                if city_name not in prev_value['places']:
                    new_value['places'].append(city_name)
                    new_value['places'] = list(set(new_value['places']))
                    album_date.location = new_value
            else:
                album_date.location = {'places':[city_name]}

        album_date.save()


    def _add_to_album_place(self):
        if self.geolocation_json and len(self.geolocation_json) > 0:
            if 'features' in self.geolocation_json.keys():
                for geolocation_level,feature in enumerate(self.geolocation_json['features']):
                    if 'text' in feature.keys():
                        if not feature['text'].isnumeric():
                            album_place = get_album_place(feature['text'])[0]
                            if album_place.photos.filter(image_hash=self.image_hash).count() == 0:
                                album_place.geolocation_level = len(self.geolocation_json['features']) - geolocation_level
                                album_place.photos.add(self)
                                if album_place.cover_photos.count() < 4:
                                    album_place.cover_photos.add(self)
                                album_place.save()
        else:
            logger.warning('photo not addded to album place')
            print('photo not added to album place')


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

    def get_photos(self):
        # prefetch_related(Prefetch('faces__photo', queryset=Photo.objects.all().order_by('-exif_timestamp').only('image_hash','exif_timestamp','favorited','hidden'))).order_by('name')
        faces = list(self.faces.prefetch_related(Prefetch('photo', queryset=Photo.objects.all().order_by('-exif_timestamp').only('image_hash','exif_timestamp','favorited','hidden'))))
        photos = [face.photo for face in faces]
        return photos
        


def get_unknown_person():
    return Person.objects.get_or_create(name='unknown')[0]

class Face(models.Model):
    photo = models.ForeignKey(Photo, related_name='faces', on_delete=models.SET(get_unknown_person), blank=False, null=True)
    image = models.ImageField(upload_to='faces')
    image_path = models.FilePathField()
    
    person = models.ForeignKey(Person, on_delete=models.SET(get_unknown_person), related_name='faces')
    person_label_is_inferred = models.NullBooleanField(db_index=True)
    person_label_probability = models.FloatField(default=0.,db_index=True)

    # ignore = models.BooleanField(default=False,db_index=True)

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()

    encoding = models.TextField()

    def __str__(self):
        return "%d"%self.id


class AlbumThing(models.Model):
    title = models.CharField(unique=True,max_length=512,db_index=True)
    photos = models.ManyToManyField(Photo)
    cover_photos = models.ManyToManyField(Photo,related_name='album_thing_cover_photos') # should only have 4 photos. isn't enforced.
    thing_type = models.CharField(max_length=512,db_index=True,null=True)
    favorited = models.BooleanField(default=False,db_index=True)

    def __str__(self):
        return "%d: %s"%(self.id, self.title)


class AlbumPlace(models.Model):
    title = models.CharField(unique=True,max_length=512,db_index=True)
    photos = models.ManyToManyField(Photo)
    geolocation_level = models.IntegerField(db_index=True,null=True)
    favorited = models.BooleanField(default=False,db_index=True)
    cover_photos = models.ManyToManyField(Photo,related_name='album_place_cover_photos') # should only have 4 photos. isn't enforced.



    def __str__(self):
        return "%d: %s"%(self.id, self.title)


class AlbumDate(models.Model):
    title = models.CharField(blank=True,null=True,max_length=512,db_index=True)
    date = models.DateField(unique=True,db_index=True,null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False,db_index=True)
    location = JSONField(blank=True,db_index=True,null=True)

    def __str__(self):
        return "%d: %s"%(self.id, self.title)

    def ordered_photos(self):
        return self.photos.all().order_by('-exif_timestamp')


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

        when = ' '.join([weekday,time])

        photos = self.photos.all()

        loc = ''
        pep = ''

        places = []
        people = []
        timestamps = []

        for photo in photos:
            if photo.geolocation_json and 'features' in photo.geolocation_json.keys():
                for feature in photo.geolocation_json['features']:
                    if feature['place_type'][0] == 'place':
                        places.append(feature['text'])

            timestamps.append(photo.exif_timestamp)

            faces = photo.faces.all()
            for face in faces:
                people.append(face.person.name)

        if len(places) > 0:
            cnts_places = Counter(places)
            loc = 'in ' + ' and '.join(dict(cnts_places.most_common(2)).keys())
        if len(people) > 0:
            cnts_people = Counter(people)
            names = dict([(k,v) for k,v in cnts_people.most_common(2) if k.lower() != 'unknown']).keys()
            if len(names) > 0:
                pep = 'with ' + ' and '.join(names)

        if (max(timestamps) - min(timestamps)).days >= 3:
            when = '%d days'%((max(timestamps) - min(timestamps)).days)

        title = ' '.join([when,pep,loc]).strip()
        self.title = title

    def __str__(self):
        return "%d: %s"%(self.id, self.title)

class AlbumUser(models.Model):
    title = models.CharField(unique=True,max_length=512)
    created_on = models.DateTimeField(auto_now=True,db_index=True)
    photos = models.ManyToManyField(Photo)
    cover_photos = models.ManyToManyField(Photo,related_name='album_user_cover_photos') # should only have 4 photos. isn't enforced.
    favorited = models.BooleanField(default=False,db_index=True)

class LongRunningJob(models.Model):
    JOB_SCAN_PHOTOS = 1
    JOB_GENERATE_AUTO_ALBUMS = 2
    JOB_GENERATE_AUTO_ALBUM_TITLES = 3
    JOB_TRAIN_FACES = 4
    JOB_TYPES = (
        (JOB_SCAN_PHOTOS, "Scan Photos"),
        (JOB_GENERATE_AUTO_ALBUMS, "Generate Event Albums"),
        (JOB_GENERATE_AUTO_ALBUM_TITLES, "Regenerate Event Titles"),
        (JOB_TRAIN_FACES, "Train Faces"),
    )


    job_type = models.PositiveIntegerField(
        choices=JOB_TYPES,
    )

    finished = models.BooleanField(default=False,blank=False,null=False)
    failed = models.BooleanField(default=False,blank=False,null=False)
    job_id = models.CharField(max_length=36,unique=True,db_index=True)
    started_at = models.DateTimeField(null=False)
    finished_at = models.DateTimeField(null=True)
    result = JSONField(default={},blank=False,null=False)


# for cache invalidation. invalidates all cache on modelviewsets on delete and save on any model
for model in [Photo, Person, Face, AlbumDate, AlbumAuto, AlbumUser, AlbumPlace, AlbumThing]:
    post_save.connect(receiver=change_api_updated_at, sender=model)
    post_delete.connect(receiver=change_api_updated_at, sender=model)
