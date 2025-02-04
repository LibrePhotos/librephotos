from collections import Counter

from django.db import models

from api import util
from api.models.person import Person
from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class AlbumAuto(models.Model):
    title = models.CharField(blank=True, null=True, max_length=512)
    timestamp = models.DateTimeField(db_index=True)
    created_on = models.DateTimeField(auto_now=False, db_index=True)
    gps_lat = models.FloatField(blank=True, null=True)
    gps_lon = models.FloatField(blank=True, null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="album_auto_shared_to")

    class Meta:
        unique_together = ("timestamp", "owner")

    def _generate_title(self):
        try:
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

            when = " ".join([weekday, time])

            photos = self.photos.all()

            loc = ""
            pep = ""

            places = []
            people = []
            timestamps = []

            for photo in photos:
                if (
                    photo.geolocation_json
                    and "places" in photo.geolocation_json.keys()
                    and len(photo.geolocation_json["places"]) > 0
                ):
                    places = photo.geolocation_json["places"]

                timestamps.append(photo.exif_timestamp)

                faces = photo.faces.all()
                for face in faces:
                    people.append(face.person.name)

            if len(places) > 0:
                cnts_places = Counter(places)
                loc = "in " + " and ".join(dict(cnts_places.most_common(2)).keys())
            if len(people) > 0:
                cnts_people = Counter(people)
                names = dict(
                    [
                        (k, v)
                        for k, v in cnts_people.most_common(2)
                        if k.lower() != "unknown"
                        and k.lower() != Person.UNKNOWN_PERSON_NAME
                    ]
                ).keys()
                if len(names) > 0:
                    pep = "with " + " and ".join(names)
            if len(timestamps) > 0:
                if (max(timestamps) - min(timestamps)).days >= 3:
                    when = "%d days" % ((max(timestamps) - min(timestamps)).days)

                weekend = [5, 6]
                if (
                    max(timestamps).weekday() in weekend
                    and min(timestamps).weekday() in weekend
                    and not (max(timestamps).weekday() == min(timestamps).weekday())
                ):
                    when = "Weekend"

            title = " ".join([when, pep, loc]).strip()
            self.title = title
            self.save()
        except Exception as e:
            util.logger.exception(e)

    def __str__(self):
        return "%d: %s" % (self.id, self.title)
