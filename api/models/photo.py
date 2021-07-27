
import hashlib
from api.thumbnails import createThumbnail, createAnimatedThumbnail, doesVideoThumbnailExists, doesStaticThumbnailExists, createThumbnailForVideo
import os
from datetime import datetime
from io import BytesIO
from api.im2txt.sample import im2txt
import exiftool
import api.models
import api.util as util
import face_recognition
import numpy as np
import PIL
import pytz
from django.core.cache import cache
from api.models.user import User, get_deleted_user
from api.places365.places365 import place365_instance
from api.semantic_search.semantic_search import semantic_search_instance
from api.util import logger
from django.core.files.base import ContentFile
from django.db import models
from django.contrib.postgres.fields import ArrayField
from geopy.geocoders import Nominatim
from django.db.models import Q
class VisiblePhotoManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(Q(hidden=False) & Q(aspect_ratio__isnull=False))

class Photo(models.Model):
    image_paths = models.JSONField(default=list)
    image_hash = models.CharField(primary_key=True, max_length=64, null=False)

    thumbnail_big = models.ImageField(upload_to='thumbnails_big')

    square_thumbnail = models.ImageField(upload_to='square_thumbnails')
    square_thumbnail_small = models.ImageField(
        upload_to='square_thumbnails_small')

    image = models.ImageField(upload_to='photos')

    aspect_ratio = models.FloatField(blank=True, null=True)

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
    video = models.BooleanField(default=False)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(User, related_name='photo_shared_to')

    public = models.BooleanField(default=False, db_index=True)
    clip_embeddings = ArrayField(models.FloatField(blank=True, null=True), size=512)
    clip_embeddings_magnitude = models.FloatField(blank=True, null=True)
    
    objects = models.Manager()
    visible = VisiblePhotoManager()

    def _generate_md5(self):
        hash_md5 = hashlib.md5()
        with open(self.image_paths[0], "rb") as f:
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

    def _generate_clip_embeddings(self, commit=True):
        image_path = self.thumbnail_big.path
        if not self.clip_embeddings:
            try:
                img_emb, magnitude = semantic_search_instance.calculate_clip_embeddings(image_path)
                self.clip_embeddings = img_emb
                self.clip_embeddings_magnitude = magnitude
                if commit:
                    self.save()
                util.logger.info(
                    'generated clip embeddings for image %s.' % (image_path))
            except Exception as e:
                util.logger.exception(
                    'could not generate clip embeddings for image %s' %
                    image_path)

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
        if not doesStaticThumbnailExists('thumbnails_big', self.image_hash):
            if(not self.video):
                createThumbnail(inputPath=self.image_paths[0], outputHeight=1080, outputPath='thumbnails_big', hash=self.image_hash, fileType=".webp")
            else:
                createThumbnailForVideo(inputPath=self.image_paths[0], outputPath='thumbnails_big', hash=self.image_hash, fileType=".webp") 

        if(not self.video and not doesStaticThumbnailExists('square_thumbnails', self.image_hash)):
            createThumbnail(inputPath=self.image_paths[0], outputHeight=500,outputPath='square_thumbnails', hash=self.image_hash, fileType=".webp")
        if(self.video and not doesVideoThumbnailExists('square_thumbnails', self.image_hash)):
            createAnimatedThumbnail(inputPath=self.image_paths[0], outputHeight=500,outputPath='square_thumbnails', hash=self.image_hash, fileType=".mp4")

        if(not self.video and not doesStaticThumbnailExists('square_thumbnails_small', self.image_hash)):
            createThumbnail(inputPath=self.image_paths[0], outputHeight=250, outputPath='square_thumbnails_small', hash=self.image_hash, fileType=".webp")
        if(self.video and not doesVideoThumbnailExists('square_thumbnails_small', self.image_hash)):
            createAnimatedThumbnail(inputPath=self.image_paths[0], outputHeight=250, outputPath='square_thumbnails_small', hash=self.image_hash, fileType=".mp4")          
        filetype = '.webp'
        if(self.video):
            filetype = '.mp4'
        self.thumbnail_big.name=os.path.join('thumbnails_big', self.image_hash + ".webp").strip()
        self.square_thumbnail.name=os.path.join('square_thumbnails', self.image_hash + filetype).strip()
        self.square_thumbnail_small.name=os.path.join('square_thumbnails_small', self.image_hash + filetype).strip()
        if commit:
            self.save()

    def _save_image_to_db(self):
        image = self.get_pil_image()
        image_io = BytesIO()
        image.save(image_io, format="JPEG")
        self.image.save(self.image_hash + '.jpg',
                        ContentFile(image_io.getvalue()))
        image_io.close()

    def _find_album_place(self):
        return api.models.AlbumPlace.objects().filter(photos__in=self)

    def _find_album_date(self):
        old_album_date = None
        if self.exif_timestamp:
            possible_old_album_date = api.models.album_date.get_album_date(
                date=self.exif_timestamp.date(), owner=self.owner)
            if(possible_old_album_date != None and possible_old_album_date.photos.filter(image_hash=self.image_hash).exists):
                old_album_date = possible_old_album_date
        else:
            possible_old_album_date = api.models.album_date.get_album_date(date=None, owner=self.owner)
            if(possible_old_album_date != None and possible_old_album_date.photos.filter(image_hash=self.image_hash).exists):
                old_album_date = possible_old_album_date
        return old_album_date

    def _calculate_aspect_ratio(self, et, commit=True):
        with exiftool.ExifTool() as et:
            height = et.get_tag('ImageHeight', self.thumbnail_big.path)
            width = et.get_tag('ImageWidth', self.thumbnail_big.path)
            self.aspect_ratio = round((width / height), 2)

        if commit:
            self.save()

    def _extract_date_time_from_exif(self,commit=True):
        date_format = "%Y:%m:%d %H:%M:%S"
        timestamp_from_exif = None
        with exiftool.ExifTool() as et:
            exif = et.get_tag('EXIF:DateTimeOriginal', self.image_paths[0])
            exifvideo = et.get_tag('QuickTime:CreateDate', self.image_paths[0])
            if exif:
                try:
                    timestamp_from_exif = datetime.strptime(
                        exif, date_format).replace(tzinfo=pytz.utc)
                except:
                    timestamp_from_exif = None
            if exifvideo:
                try:
                    timestamp_from_exif = datetime.strptime(
                        exifvideo, date_format).replace(tzinfo=pytz.utc)
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
         with exiftool.ExifTool() as et:
            gpslon = et.get_tag('Composite:GPSLongitude', self.image_paths[0])
            gpslat = et.get_tag('Composite:GPSLatitude', self.image_paths[0])
            if(gpslon):
                self.exif_gps_lon = float(gpslon)
            if(gpslat):
                self.exif_gps_lat = float(gpslat)   
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
        old_gps_lat = self.exif_gps_lat
        old_gps_lon = self.exif_gps_lon
        self._extract_gps_from_exif()
        # Skip if it hasn't changed or is null
        if(not self.exif_gps_lat or not self.exif_gps_lon):
            return
        if (old_gps_lat == self.exif_gps_lat and old_gps_lon == self.exif_gps_lon):
            return
        # Skip if the request fails or is empty
        res = None
        try:
            res = util.mapbox_reverse_geocode(self.exif_gps_lat,self.exif_gps_lon)
            if not res or len(res) == 0:
                return
            if 'features' not in res.keys():
                return
        except:
            util.logger.exception('something went wrong with geolocating')
            return
        
        self.geolocation_json = res
        
        if 'search_text' in res.keys():
            if self.search_location:
                self.search_location = self.search_location + ' ' + res[
                    'search_text']
            else:
                self.search_location = res['search_text']
        # Delete photo from album places if location has changed
        old_album_places = self._find_album_places()
        if old_album_places is not None:
            for old_album_place in old_album_places:
                old_album_place.photos.remove(self)
                old_album_place.save()
        # Add photo to new album places
        for geolocation_level, feature in enumerate(self.geolocation_json['features']):
            if not 'text' in feature.keys() or feature['text'].isnumeric():
                continue
            album_place = api.models.album_place.get_album_place(feature['text'], owner=self.owner)
            if album_place.photos.filter(image_hash=self.image_hash).count() == 0:
                album_place.geolocation_level = len(
                    self.geolocation_json['features']) - geolocation_level
            album_place.photos.add(self)
            album_place.save()
        # Add location to album dates
        album_date = self._find_album_date()
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
        if commit:
            self.save()
        cache.clear() 
        

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


    def _check_image_paths(self):
        exisiting_image_paths = []
        for image_path in self.image_paths:
            if(os.path.exists(image_path)):
                exisiting_image_paths.append(image_path)
        self.image_paths = exisiting_image_paths
        self.save()

    def __str__(self):
        return "%s" % self.image_hash


