from datetime import datetime
import PIL
from PIL import ImageOps
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
import pyheif
import magic

from api.exifreader import rotate_image

from collections import Counter
from io import BytesIO
from django.core.files.base import ContentFile

from geopy.geocoders import Nominatim
from django.contrib.auth.models import AbstractUser

from django.db.models.signals import post_save, post_delete
from django.core.cache import cache
from django.contrib.postgres.fields import JSONField

from api.places365.places365 import inference_places365
from api.im2txt.sample import im2txt

from django_cryptography.fields import encrypt
from api.im2vec import Im2Vec

geolocator = Nominatim()
default_tz = pytz.timezone('Asia/Seoul')
im2vec = Im2Vec(cuda=False)


def change_api_updated_at(sender=None, instance=None, *args, **kwargs):
    cache.set('api_updated_at_timestamp', datetime.utcnow())


def get_or_create_album_date(date, owner):
    return AlbumDate.objects.get_or_create(date=date, owner=owner)[0]

def get_album_date(date, owner):
    try:
        return AlbumDate.objects.get(date=date, owner=owner)
    except:
        return None

def get_album_thing(title, owner):
    return AlbumThing.objects.get_or_create(title=title, owner=owner)[0]


def get_album_place(title, owner):
    return AlbumPlace.objects.get_or_create(title=title, owner=owner)[0]


def get_album_nodate(owner):
    return AlbumDate.objects.get_or_create(date=None, owner=owner)[0]


def get_admin_user():
    return User.objects.get(is_superuser=True)


def get_deleted_user():
    return User.objects.get_or_create(username='deleted')[0]


def get_unknown_person():
    return Person.objects.get_or_create(name='unknown')[0]


def get_or_create_person(name):
    return Person.objects.get_or_create(name=name)[0]


def get_default_longrunningjob_result():
    return {'progress': {'target': 0, 'current': 0}}


class User(AbstractUser):
    scan_directory = models.CharField(max_length=512, db_index=True)
    confidence = models.FloatField(default=0.1, db_index=True)
    avatar = models.ImageField(upload_to='avatars', null=True)

    nextcloud_server_address = models.CharField(
        max_length=200, default=None, null=True)
    nextcloud_username = models.CharField(
        max_length=64, default=None, null=True)
    nextcloud_app_password = encrypt(
        models.CharField(max_length=64, default=None, null=True))
    nextcloud_scan_directory = models.CharField(
        max_length=512, db_index=True, null=True)

class VisiblePhotoManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(hidden=False)

class Photo(models.Model):
    image_path = models.CharField(max_length=512, db_index=True)
    # md5_{user.id}
    image_hash = models.CharField(primary_key=True, max_length=64, null=False)

    thumbnail_big = models.ImageField(upload_to='thumbnails')

    square_thumbnail = models.ImageField(upload_to='square_thumbnails')
    square_thumbnail_small = models.ImageField(
        upload_to='square_thumbnails_small')

    image = models.ImageField(upload_to='photos')

    added_on = models.DateTimeField(null=False, blank=False, db_index=True)

    exif_gps_lat = models.FloatField(blank=True, null=True)
    exif_gps_lon = models.FloatField(blank=True, null=True)
    exif_timestamp = models.DateTimeField(blank=True, null=True, db_index=True)

    exif_json = JSONField(blank=True, null=True)

    geolocation_json = JSONField(blank=True, null=True, db_index=True)
    captions_json = JSONField(blank=True, null=True, db_index=True)

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

    def _generate_captions_im2txt(self):
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
            self.save()
            util.logger.info(
                'generated im2txt captions for image %s. caption: %s' %
                (image_path, caption))
            return True
        except:
            util.logger.warning(
                'could not generate im2txt captions for image %s' % image_path)
            return False

    def _generate_captions(self):
        image_path = self.thumbnail_big.path
        captions = {}

        # places365
        try:
            confidence = self.owner.confidence
            res_places365 = inference_places365(image_path, confidence)
            captions['places365'] = res_places365
            self.captions_json = captions
            if self.search_captions:
                self.search_captions = self.search_captions + ' , ' + \
                    ' , '.join(
                        res_places365['categories'] + [res_places365['environment']])
            else:
                self.search_captions = ' , '.join(
                    res_places365['categories'] + [res_places365['environment']])

            self.save()
            util.logger.info(
                'generated places365 captions for image %s.' % (image_path))
        except Exception as e:
            util.logger.exception(
                'could not generate places365 captions for image %s' %
                image_path)

    def isHeic(self):
        try:
            filetype = magic.from_buffer(open(self.image_path,"rb").read(2048), mime=True)
            return 'heic' in filetype or 'heif' in filetype
        except:
            util.logger.exception("An image throwed an exception")
            return False
    
    def get_pil_image(self):
        if self.isHeic():
            heif_file = pyheif.read(self.image_path)
            image = PIL.Image.frombytes(
                heif_file.mode, 
                heif_file.size, 
                heif_file.data,
                "raw",
                heif_file.mode,
                heif_file.stride,
                )
        else:
            image = PIL.Image.open(self.image_path)
        image = rotate_image(image)
        if image.mode != 'RGB':
                image = image.convert('RGB')
        return image

    def _generate_thumbnail(self):
        image = self.get_pil_image()
        if not os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT,'thumbnails_big', self.image_hash + '.jpg').strip()):
            image.thumbnail(ownphotos.settings.THUMBNAIL_SIZE_BIG,
                            PIL.Image.ANTIALIAS)
            image_io_thumb = BytesIO()
            image.save(image_io_thumb, format="JPEG")
            self.thumbnail_big.save(
                self.image_hash + '.jpg',
                ContentFile(image_io_thumb.getvalue()))
            image_io_thumb.close()
        #thumbnail already exists, add to photo
        else:
            self.thumbnail_big.name=os.path.join(ownphotos.settings.MEDIA_ROOT,'thumbnails_big', self.image_hash + '.jpg').strip()

        if not os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT,'square_thumbnails', self.image_hash + '.jpg').strip()):
            square_thumb = ImageOps.fit(image,
                                        ownphotos.settings.THUMBNAIL_SIZE_MEDIUM,
                                    PIL.Image.ANTIALIAS)
            image_io_square_thumb = BytesIO()
            square_thumb.save(image_io_square_thumb, format="JPEG")
            self.square_thumbnail.save(
                self.image_hash + '.jpg',
                ContentFile(image_io_square_thumb.getvalue()))
            image_io_square_thumb.close()
        #thumbnail already exists, add to photo
        else:
            self.square_thumbnail.name=os.path.join(ownphotos.settings.MEDIA_ROOT,'square_thumbnails', self.image_hash + '.jpg').strip()

        if not os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT,'square_thumbnails_small', self.image_hash + '.jpg').strip()):
            square_thumb = ImageOps.fit(image,
                                    ownphotos.settings.THUMBNAIL_SIZE_SMALL,
                                    PIL.Image.ANTIALIAS)
            image_io_square_thumb = BytesIO()
            square_thumb.save(image_io_square_thumb, format="JPEG")
            self.square_thumbnail_small.save(
                self.image_hash + '.jpg',
                ContentFile(image_io_square_thumb.getvalue()))
            image_io_square_thumb.close()
        #thumbnail already exists, add to photo
        else:
            self.square_thumbnail_small.name=os.path.join(ownphotos.settings.MEDIA_ROOT,'square_thumbnails_small', self.image_hash + '.jpg').strip()
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
            possible_old_album_date = get_album_date(
                date=self.exif_timestamp.date(), owner=self.owner)
            if(possible_old_album_date != None and possible_old_album_date.photos.filter(image_path=self.image_path).exists):
                old_album_date = possible_old_album_date
        else:
            possible_old_album_date = get_album_date(date=None, owner=self.owner)
            if(possible_old_album_date != None and possible_old_album_date.photos.filter(image_path=self.image_path).exists):
                old_album_date = possible_old_album_date
        return old_album_date

    def _extract_date_time_from_exif(self):
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
            album_date = get_or_create_album_date(date=self.exif_timestamp.date(), owner=self.owner)
            album_date.photos.add(self)
        else:
            album_date = get_or_create_album_date(date=None, owner=self.owner)
            album_date.photos.add(self)
        
        album_date.save()
        self.save()

    def _extract_gps_from_exif(self):
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
        self.save()

    def _geolocate(self):
        if not (self.exif_gps_lat and self.exif_gps_lon):
            self._extract_gps_from_exif()
        if (self.exif_gps_lat and self.exif_gps_lon):
            try:
                location = geolocator.reverse(
                    "%f,%f" % (self.exif_gps_lat, self.exif_gps_lon))
                location = location.raw
                self.geolocation_json = location
                self.save()
            except:
                pass

    def _geolocate_mapbox(self):
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
                self.save()
            except:
                util.logger.warning('something went wrong with geolocating')
                pass

    def _im2vec(self):
        try:
            image = PIL.Image.open(self.square_thumbnail)
            vec = im2vec.get_vec(image)
            self.encoding = vec.tobytes().hex()
            self.save()
        except ValueError:
            pass

    def _extract_faces(self):
        qs_unknown_person = Person.objects.filter(name='unknown')
        if qs_unknown_person.count() == 0:
            unknown_person = Person(name='unknown')
            unknown_person.save()
        else:
            unknown_person = qs_unknown_person[0]
        image = np.array(self.get_pil_image())

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

                face = Face()
                face.image_path = self.image_hash + "_" + str(
                    idx_face) + '.jpg'
                face.person = unknown_person
                face.photo = self
                face.location_top = face_location[0]
                face.location_right = face_location[1]
                face.location_bottom = face_location[2]
                face.location_left = face_location[3]
                face.encoding = face_encoding.tobytes().hex()
                #                 face.encoding = face_encoding.dumps()

                face_io = BytesIO()
                face_image.save(face_io, format="JPEG")
                face.image.save(face.image_path,
                                ContentFile(face_io.getvalue()))
                face_io.close()
                face.save()
            logger.info('image {}: {} face(s) saved'.format(
                self.image_hash, len(face_locations)))

    def _add_to_album_thing(self):
        if type(self.captions_json
                ) is dict and 'places365' in self.captions_json.keys():
            for attribute in self.captions_json['places365']['attributes']:
                album_thing = get_album_thing(
                    title=attribute, owner=self.owner)
                if album_thing.photos.filter(
                       image_hash=self.image_hash).count() == 0:
                    album_thing.photos.add(self)
                    album_thing.thing_type = 'places365_attribute'
                    album_thing.save()
            for category in self.captions_json['places365']['categories']:
                album_thing = get_album_thing(title=category, owner=self.owner)
                if album_thing.photos.filter(
                        image_hash=self.image_hash).count() == 0:
                    album_thing = get_album_thing(
                        title=category, owner=self.owner)
                    album_thing.photos.add(self)
                    album_thing.thing_type = 'places365_category'
                    album_thing.save()

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

    def _add_to_album_place(self):
        if not self.geolocation_json or len(self.geolocation_json) == 0:
            return
        if 'features' not in self.geolocation_json.keys():
            return

        for geolocation_level, feature in enumerate(self.geolocation_json['features']):
            if not 'text' in feature.keys() or feature['text'].isnumeric():
                continue
            album_place = get_album_place(feature['text'], owner=self.owner)
            if album_place.photos.filter(image_hash=self.image_hash).count() == 0:
                album_place.geolocation_level = len(
                    self.geolocation_json['features']) - geolocation_level
            album_place.photos.add(self)
            album_place.save()

    def __str__(self):
        return "%s" % self.image_hash


class Person(models.Model):
    KIND_CHOICES = (('USER', 'User Labelled'), ('CLUSTER', 'Cluster ID'),
                    ('UNKNOWN', 'Unknown Person'))
    name = models.CharField(blank=False, max_length=128)
    kind = models.CharField(choices=KIND_CHOICES, max_length=10)
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    account = models.OneToOneField(
        User, on_delete=models.SET(get_deleted_user), default=None, null=True)

    def __str__(self):
        return "%d" % self.id

    def _update_average_face_encoding(self):
        encodings = []
        faces = self.faces.all()
        for face in faces:
            r = base64.b64decode(face.encoding)
            encoding = np.frombuffer(r, dtype=np.float64)
            encodings.append(encoding)
        mean_encoding = np.array(encodings).mean(axis=0)
        self.mean_face_encoding = base64.encodebytes(mean_encoding.tostring())
        # ipdb.set_trace()

    def get_photos(self, owner):
        faces = list(
            self.faces.prefetch_related(
                Prefetch(
                    'photo',
                    queryset=Photo.objects.exclude(image_hash=None).filter(hidden=False,
                        owner=owner).order_by('-exif_timestamp').only(
                            'image_hash', 'exif_timestamp', 'favorited',
                            'owner__id', 'public',
                            'hidden').prefetch_related('owner'))))

        photos = [face.photo for face in faces if hasattr(face.photo, 'owner')]
        return photos


class Face(models.Model):
    photo = models.ForeignKey(
        Photo,
        related_name='faces',
        on_delete=models.SET(get_unknown_person),
        blank=False,
        null=True)
    image = models.ImageField(upload_to='faces')
    image_path = models.FilePathField()

    person = models.ForeignKey(
        Person, on_delete=models.SET(get_unknown_person), related_name='faces')
    person_label_is_inferred = models.NullBooleanField(db_index=True)
    person_label_probability = models.FloatField(default=0., db_index=True)

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()

    encoding = models.TextField()

    def __str__(self):
        return "%d" % self.id


class AlbumThing(models.Model):
    title = models.CharField(max_length=512, db_index=True)
    photos = models.ManyToManyField(Photo)
    thing_type = models.CharField(max_length=512, db_index=True, null=True)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(
        User, related_name='album_thing_shared_to')

    class Meta:
        unique_together = ('title', 'owner')

    @property
    def cover_photos(self):
        return self.photos.filter(hidden=False)[:4]

    def __str__(self):
        return "%d: %s" % (self.id, self.title)


class AlbumPlace(models.Model):
    title = models.CharField(max_length=512, db_index=True)
    photos = models.ManyToManyField(Photo)
    geolocation_level = models.IntegerField(db_index=True, null=True)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(
        User, related_name='album_place_shared_to')

    class Meta:
        unique_together = ('title', 'owner')

    @property
    def cover_photos(self):
        return self.photos.filter(hidden=False)[:4]

    def __str__(self):
        return "%d: %s" % (self.id, self.title)


class AlbumDate(models.Model):
    title = models.CharField(
        blank=True, null=True, max_length=512, db_index=True)
    date = models.DateField(db_index=True, null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    location = JSONField(blank=True, db_index=True, null=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)
    shared_to = models.ManyToManyField(
        User, related_name='album_date_shared_to')

    class Meta:
        unique_together = ('date', 'owner')

    def __str__(self):
        return "%d: %s" % (self.id, self.title)

    def ordered_photos(self):
        return self.photos.all().order_by('-exif_timestamp')


class AlbumAuto(models.Model):
    title = models.CharField(blank=True, null=True, max_length=512)
    timestamp = models.DateTimeField(db_index=True)
    created_on = models.DateTimeField(auto_now=False, db_index=True)
    gps_lat = models.FloatField(blank=True, null=True)
    gps_lon = models.FloatField(blank=True, null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(
        User, related_name='album_auto_shared_to')

    class Meta:
        unique_together = ('timestamp', 'owner')

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
            elif hour >= 18 and hour <= 24:
                time = "Evening"

        when = ' '.join([weekday, time])

        photos = self.photos.all()

        loc = ''
        pep = ''

        places = []
        people = []
        timestamps = []

        for photo in photos:
            if photo.geolocation_json and 'features' in photo.geolocation_json.keys(
            ):
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
            names = dict([(k, v) for k, v in cnts_people.most_common(2)
                          if k.lower() != 'unknown']).keys()
            if len(names) > 0:
                pep = 'with ' + ' and '.join(names)

        if (max(timestamps) - min(timestamps)).days >= 3:
            when = '%d days' % ((max(timestamps) - min(timestamps)).days)

        weekend = [5, 6]
        if max(timestamps).weekday() in weekend and min(
                timestamps).weekday() in weekend and not (
                    max(timestamps).weekday() == min(timestamps).weekday()):
            when = "Weekend"

        title = ' '.join([when, pep, loc]).strip()
        self.title = title

    def __str__(self):
        return "%d: %s" % (self.id, self.title)


class AlbumUser(models.Model):
    title = models.CharField(max_length=512)
    created_on = models.DateTimeField(auto_now=True, db_index=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(
        User, related_name='album_user_shared_to')

    public = models.BooleanField(default=False, db_index=True)

    class Meta:
        unique_together = ('title', 'owner')

    @property
    def cover_photos(self):
        return self.photos.filter(hidden=False)[:4]


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

    job_type = models.PositiveIntegerField(choices=JOB_TYPES, )

    finished = models.BooleanField(default=False, blank=False, null=False)
    failed = models.BooleanField(default=False, blank=False, null=False)
    job_id = models.CharField(max_length=36, unique=True, db_index=True)
    queued_at = models.DateTimeField(default=datetime.now, null=False)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    result = JSONField(
        default=get_default_longrunningjob_result, blank=False, null=False)
    started_by = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)


# for cache invalidation. invalidates all cache on modelviewsets on delete and save on any model
for model in [
        Photo, Person, Face, AlbumDate, AlbumAuto, AlbumUser, AlbumPlace,
        AlbumThing
]:
    post_save.connect(receiver=change_api_updated_at, sender=model)
    post_delete.connect(receiver=change_api_updated_at, sender=model)
