from collections import Counter

from django.db import models

from api import util
from api.models.person import Person
from api.models.photo import Photo
from api.models.user import User, get_deleted_user

TIME_OF_DAY = (
    (5, "Early Morning"),
    (12, "Morning"),
    (18, "Afternoon"),
    (25, "Evening"),
)
WEEKEND = [5, 6]


def _time_of_day(hour):
    if hour <= 0:
        return ""
    for until, label in TIME_OF_DAY:
        if hour < until:
            return label
    return ""


def _collect_photo_details(photos):
    places = []
    people = []
    timestamps = []
    for photo in photos:
        geolocation = photo.geolocation_json
        if geolocation and len(geolocation.get("places", [])) > 0:
            places = geolocation["places"]
        timestamps.append(photo.exif_timestamp)
        for face in photo.faces.all():
            people.append(face.person.name)
    return places, people, timestamps


def _describe_places(places):
    if not places:
        return ""
    return "in " + " and ".join(dict(Counter(places).most_common(2)).keys())


def _describe_people(people):
    if not people:
        return ""
    names = dict(
        [
            (k, v)
            for k, v in Counter(people).most_common(2)
            if k.lower() != "unknown" and k.lower() != Person.UNKNOWN_PERSON_NAME
        ]
    ).keys()
    if not names:
        return ""
    return "with " + " and ".join(names)


def _describe_span(timestamps, when):
    if not timestamps:
        return when
    first = min(timestamps)
    last = max(timestamps)
    if (last - first).days >= 3:
        when = "%d days" % ((last - first).days)
    if (
        last.weekday() in WEEKEND
        and first.weekday() in WEEKEND
        and last.weekday() != first.weekday()
    ):
        when = "Weekend"
    return when


class AlbumAuto(models.Model):
    title = models.CharField(
        blank=False, null=False, max_length=512, default="Untitled Album"
    )
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
            if self.timestamp:
                weekday = util.weekdays[self.timestamp.isoweekday()]
                time = _time_of_day(self.timestamp.hour)

            when = " ".join([weekday, time])

            places, people, timestamps = _collect_photo_details(self.photos.all())
            loc = _describe_places(places)
            pep = _describe_people(people)
            when = _describe_span(timestamps, when)

            title = " ".join([when, pep, loc]).strip()
            # Ensure title is never empty
            if not title:
                title = f"Album from {self.timestamp.strftime('%Y-%m-%d')}"
            self.title = title
            self.save()
        except Exception as e:
            util.logger.exception(e)
            # Set a fallback title if something goes wrong
            self.title = f"Album from {self.timestamp.strftime('%Y-%m-%d')}"
            self.save()

    def __str__(self):
        return "%d: %s" % (self.id, self.title)
