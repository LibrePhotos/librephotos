
import hashlib
import os
from datetime import datetime
from io import BytesIO

import magic
import api.models
import api.util as util
import exifread
import face_recognition
import numpy as np
import ownphotos.settings
import PIL
import pyheif
import pytz
from django.core.cache import cache
from api.exifreader import rotate_image
from api.im2vec import Im2Vec
from api.models.user import User, get_deleted_user
from api.places365.places365 import place365_instance
from api.util import logger
from django.core.files.base import ContentFile
from django.db import models
from geopy.geocoders import Nominatim
from PIL import ImageOps
from wand.image import Image

class VisiblePhotoManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(hidden=False)

class Photo(models.Model):
    image_path = models.CharField(max_length=512, db_index=True)
    image_hash = models.CharField(primary_key=True, max_length=64, null=False)

    thumbnail_big = models.ImageField(upload_to='thumbnails_big')

    square_thumbnail = models.ImageField(upload_to='square_thumbnails')
    square_thumbnail_small = models.ImageField(
        upload_to='square_thumbnails_small')

    image = models.ImageField(upload_to='photos')

    added_on = models.DateTimeField(null=False, blank=False, db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True, null=True, db_index=True)

    exif_json = models.JSONField(blank=True, null=True)

    geolocation_json = models.JSONField(blank=True, null=True, db_index=True)
    captions_json = models.JSONField(blank=True, null=True, db_index=True)

    search_captions = models.TextField(blank=True, null=True, db_index=True)
    search_location = models.TextField(blank=True, null=True, db_index=True)

    favorited = models.BooleanField(default=False, db_index=True)
    hidden = models.BooleanField(default=False, db_index=True)

    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(User, related_name='photo_shared_to')

    public = models.BooleanField(default=False, db_index=True)
    encoding = models.TextField(default=None, null=True)
    
    objects = models.Manager()
    visible = VisiblePhotoManager()

    def _generate_md5(self):
        hash_md5 = hashlib.md5()
        with open(self.image_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        self.image_hash = hash_md5.hexdigest() + str(self.owner.id)
        self.save()

    def _generate_captions_im2txt(self,commit=True):
        image_path = self.thumbnail_big.path
        captions = self.captions_json
        search_captions = self.search_captions
        try:
            caption = im2txt(image_path)
            caption = caption.replace("<start>",
                                      '').replace("<end>", '').strip().lower()
            captions['im2txt'] = caption
            self.captions_json = captions
            # todo: handle duplicate captions
            self.search_captions = search_captions + caption
            if commit:
                self.save()
            util.logger.info(
                'generated im2txt captions for image %s. caption: %s' %
                (image_path, caption))
            return True
        except:
            util.logger.warning(
                'could not generate im2txt captions for image %s' % image_path)
            return False

    def _generate_captions(self,commit):
        image_path = self.thumbnail_big.path
        captions = {}

        # places365
        try:
            confidence = self.owner.confidence
            res_places365 = place365_instance.inference_places365(image_path, confidence)
            captions['places365'] = res_places365
            self.captions_json = captions
            if self.search_captions:
                self.search_captions = self.search_captions + ' , ' + \
                    ' , '.join(
                        res_places365['categories'] + [res_places365['environment']])
            else:
                self.search_captions = ' , '.join(
                    res_places365['categories'] + [res_places365['environment']])
            if commit:
                self.save()
            util.logger.info(
                'generated places365 captions for image %s.' % (image_path))
        except Exception as e:
            util.logger.exception(
                'could not generate places365 captions for image %s' %
                image_path)

    def _generate_thumbnail(self,commit=True):
        if not os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT,'thumbnails_big', self.image_hash + '.jpg').strip()):
            with Image(filename=self.image_path) as img:
                with BytesIO() as transfer:
                    with img.clone() as thumbnail: 
                        thumbnail.format = "jpg" 
                        thumbnail.transform(resize='x' + str(ownphotos.settings.THUMBNAIL_SIZE_BIG[1]))
                        thumbnail.compression_quality = 80
                        thumbnail.save(transfer)
                    self.thumbnail_big.save(self.image_hash + '.jpg', ContentFile(transfer.getvalue()))
        #thumbnail already exists, add to photo
        else:
            self.thumbnail_big.name=os.path.join('thumbnails_big', self.image_hash + '.jpg').strip()

        if not os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT,'square_thumbnails', self.image_hash + '.jpg').strip()):
            with Image(filename=self.image_path) as img:
                with BytesIO() as transfer:
                    with img.clone() as thumbnail: 
                        thumbnail.format = "jpg"
                        dst_landscape = 1 > thumbnail.width / thumbnail.height
                        wh = thumbnail.width if dst_landscape else thumbnail.height
                        thumbnail.crop(
                            left=int((thumbnail.width - wh) / 2),
                            top=int((thumbnail.height - wh) / 2),
                            width=int(wh),
                            height=int(wh)
                        )
                        thumbnail.resize(width=ownphotos.settings.THUMBNAIL_SIZE_MEDIUM[0], height=ownphotos.settings.THUMBNAIL_SIZE_MEDIUM[1])
                        thumbnail.resolution = (ownphotos.settings.THUMBNAIL_SIZE_MEDIUM[0], ownphotos.settings.THUMBNAIL_SIZE_MEDIUM[1])
                        thumbnail.compression_quality = 80
                        thumbnail.save(transfer)
                    self.square_thumbnail.save(self.image_hash + '.jpg', ContentFile(transfer.getvalue()))
        #thumbnail already exists, add to photo
        else:
            self.square_thumbnail.name=os.path.join('square_thumbnails', self.image_hash + '.jpg').strip()

        if not os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT,'square_thumbnails_small', self.image_hash + '.jpg').strip()):
            with Image(filename=self.image_path) as img:
                with BytesIO() as transfer:
                    with img.clone() as thumbnail: 
                        thumbnail.format = "jpg"
                        dst_landscape = 1 > thumbnail.width / thumbnail.height
                        wh = thumbnail.width if dst_landscape else thumbnail.height
                        thumbnail.crop(
                            left=int((thumbnail.width - wh) / 2),
                            top=int((thumbnail.height - wh) / 2),
                            width=int(wh),
                            height=int(wh)
                        )
                        thumbnail.resize(width=ownphotos.settings.THUMBNAIL_SIZE_SMALL[0], height=ownphotos.settings.THUMBNAIL_SIZE_SMALL[1])
                        thumbnail.resolution = (ownphotos.settings.THUMBNAIL_SIZE_SMALL[0], ownphotos.settings.THUMBNAIL_SIZE_SMALL[1])
                        thumbnail.compression_quality = 80
                        thumbnail.save(transfer)
                    self.square_thumbnail_small.save(self.image_hash + '.jpg', ContentFile(transfer.getvalue()))
        #thumbnail already exists, add to photo
        else:
            self.square_thumbnail_small.name=os.path.join('square_thumbnails_small', self.image_hash + '.jpg').strip()
        if commit:
            self.save()

    def _save_image_to_db(self):
        image = self.get_pil_image()
        image_io = BytesIO()
        image.save(image_io, format="JPEG")
        self.image.save(self.image_hash + '.jpg',
                        ContentFile(image_io.getvalue()))
        image_io.close()

    def _find_album_date(self):
        old_album_date = None
        if self.exif_timestamp:
            possible_old_album_date = api.models.album_date.get_album_date(
                date=self.exif_timestamp.date(), owner=self.owner)
            if(possible_old_album_date != None and possible_old_album_date.photos.filter(image_path=self.image_path).exists):
                old_album_date = possible_old_album_date
        else:
            possible_old_album_date = api.models.album_date.get_album_date(date=None, owner=self.owner)
            if(possible_old_album_date != None and possible_old_album_date.photos.filter(image_path=self.image_path).exists):
                old_album_date = possible_old_album_date
        return old_album_date

    def _extract_date_time_from_exif(self,commit=True):
        date_format = "%Y:%m:%d %H:%M:%S"
        timestamp_from_exif = None
        with open(self.image_path, 'rb') as fimg:
            exif = exifread.process_file(fimg, details=False)
            serializable = dict(
                [key, value.printable] for key, value in exif.items())
            self.exif_json = serializable
            if 'EXIF DateTimeOriginal' in exif.keys():
                tst_str = exif['EXIF DateTimeOriginal'].values
                try:
                    timestamp_from_exif = datetime.strptime(
                        tst_str, date_format).replace(tzinfo=pytz.utc)
                except:
                    timestamp_from_exif = None

        old_album_date = self._find_album_date()

        if(self.exif_timestamp != timestamp_from_exif):
            self.exif_timestamp = timestamp_from_exif

        if old_album_date is not None:
            old_album_date.photos.remove(self)
            old_album_date.save()

        album_date = None

        if self.exif_timestamp:
            album_date = api.models.album_date.get_or_create_album_date(date=self.exif_timestamp.date(), owner=self.owner)  
            album_date.photos.add(self)
        else:
            album_date = api.models.album_date.get_or_create_album_date(date=None, owner=self.owner)
            album_date.photos.add(self)
        cache.clear()
        if commit:
            self.save()
        album_date.save()

    def _extract_gps_from_exif(self,commit=True):
        with open(self.image_path, 'rb') as fimg:
            exif = exifread.process_file(fimg, details=False)
            serializable = dict(
                [key, value.printable] for key, value in exif.items())
            self.exif_json = serializable
            if 'GPS GPSLongitude' in exif.keys():
                self.exif_gps_lon = util.convert_to_degrees(
                    exif['GPS GPSLongitude'].values)
                # Check for correct positive/negative degrees
                if exif['GPS GPSLongitudeRef'].values != 'E':
                    self.exif_gps_lon = -float(self.exif_gps_lon)
            else:
                self.exif_gps_lon = None

            if 'GPS GPSLatitude' in exif.keys():
                self.exif_gps_lat = util.convert_to_degrees(
                    exif['GPS GPSLatitude'].values)
                # Check for correct positive/negative degrees
                if exif['GPS GPSLatitudeRef'].values != 'N':
                    self.exif_gps_lat = -float(self.exif_gps_lat)
            else:
                self.exif_gps_lat = None
        if commit:
            self.save()

    def _geolocate(self):
        if not (self.exif_gps_lat and self.exif_gps_lon):
            self._extract_gps_from_exif()
        if (self.exif_gps_lat and self.exif_gps_lon):
            try:
                geolocator = Nominatim()
                location = geolocator.reverse(
                    "%f,%f" % (self.exif_gps_lat, self.exif_gps_lon))
                location = location.raw
                self.geolocation_json = location
                self.save()
            except:
                util.logger.exception('something went wrong with geolocating')

    def _geolocate_mapbox(self,commit=True):
        if not (self.exif_gps_lat and self.exif_gps_lon):
            self._extract_gps_from_exif()
        if (self.exif_gps_lat and self.exif_gps_lon):
            try:
                res = util.mapbox_reverse_geocode(self.exif_gps_lat,
                                                  self.exif_gps_lon)
                self.geolocation_json = res
                if 'search_text' in res.keys():
                    if self.search_location:
                        self.search_location = self.search_location + ' ' + res[
                            'search_text']
                    else:
                        self.search_location = res['search_text']
                if commit:
                    self.save()
            except:
                util.logger.exception('something went wrong with geolocating')

    def _im2vec(self,commit=True):
        try:
            im2vec = Im2Vec(cuda=False)
            image = PIL.Image.open(self.square_thumbnail)
            vec = im2vec.get_vec(image)
            self.encoding = vec.tobytes().hex()
            if commit:
                self.save()
        except:
            util.logger.exception('something went wrong with im2vec')

    def _extract_faces(self):
        qs_unknown_person = api.models.person.Person.objects.filter(name='unknown')
        if qs_unknown_person.count() == 0:
            unknown_person = api.models.person.Person(name='unknown')
            unknown_person.save()
        else:
            unknown_person = qs_unknown_person[0]
        image = np.array(PIL.Image.open(self.thumbnail_big.path))

        face_locations = face_recognition.face_locations(image)
        face_encodings = face_recognition.face_encodings(
            image, known_face_locations=face_locations)

        if len(face_locations) > 0:
            for idx_face, face in enumerate(
                    zip(face_encodings, face_locations)):
                face_encoding = face[0]
                face_location = face[1]
                top, right, bottom, left = face_location
                face_image = image[top:bottom, left:right]
                face_image = PIL.Image.fromarray(face_image)

                face = api.models.face.Face()
                face.image_path = self.image_hash + "_" + str(
                    idx_face) + '.jpg'
                face.person = unknown_person
                face.photo = self
                face.location_top = face_location[0]
                face.location_right = face_location[1]
                face.location_bottom = face_location[2]
                face.location_left = face_location[3]
                face.encoding = face_encoding.tobytes().hex()
                face_io = BytesIO()
                face_image.save(face_io, format="JPEG")
                face.image.save(face.image_path,
                                ContentFile(face_io.getvalue()))
                face_io.close()
                face.save()
            logger.info('image {}: {} face(s) saved'.format(
                self.image_hash, len(face_locations)))
        cache.clear() 

    def _add_to_album_thing(self):
        if type(self.captions_json
                ) is dict and 'places365' in self.captions_json.keys():
            for attribute in self.captions_json['places365']['attributes']:
                album_thing = api.models.album_thing.get_album_thing(
                    title=attribute, owner=self.owner)
                if album_thing.photos.filter(
                       image_hash=self.image_hash).count() == 0:
                    album_thing.photos.add(self)
                    album_thing.thing_type = 'places365_attribute'
                    album_thing.save()
            for category in self.captions_json['places365']['categories']:
                album_thing = api.models.album_thing.get_album_thing(title=category, owner=self.owner)
                if album_thing.photos.filter(
                        image_hash=self.image_hash).count() == 0:
                    album_thing = api.models.album_thing.get_album_thing(
                        title=category, owner=self.owner)
                    album_thing.photos.add(self)
                    album_thing.thing_type = 'places365_category'
                    album_thing.save()
        cache.clear() 

    def _add_to_album_date(self):
        
        album_date = self._find_album_date()
        if self.geolocation_json and len(self.geolocation_json) > 0:
            util.logger.info(str(self.geolocation_json))
            city_name = [
                f['text'] for f in self.geolocation_json['features'][1:-1]
                if not f['text'].isdigit()
            ][0]
            if album_date.location and len(album_date.location) > 0:
                prev_value = album_date.location
                new_value = prev_value
                if city_name not in prev_value['places']:
                    new_value['places'].append(city_name)
                    new_value['places'] = list(set(new_value['places']))
                    album_date.location = new_value
            else:
                album_date.location = {'places': [city_name]}
        album_date.save()
        cache.clear() 

    def _add_to_album_place(self):
        if not self.geolocation_json or len(self.geolocation_json) == 0:
            return
        if 'features' not in self.geolocation_json.keys():
            return

        for geolocation_level, feature in enumerate(self.geolocation_json['features']):
            if not 'text' in feature.keys() or feature['text'].isnumeric():
                continue
            album_place = api.models.album_place.get_album_place(feature['text'], owner=self.owner)
            if album_place.photos.filter(image_hash=self.image_hash).count() == 0:
                album_place.geolocation_level = len(
                    self.geolocation_json['features']) - geolocation_level
            album_place.photos.add(self)
            album_place.save()
        cache.clear() 

    def __str__(self):
        return "%s" % self.image_hash


