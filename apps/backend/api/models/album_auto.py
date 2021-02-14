from collections import Counter

import api.util as util
from api.models.photo import Photo
from api.models.user import User, get_deleted_user
from django.db import models


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
