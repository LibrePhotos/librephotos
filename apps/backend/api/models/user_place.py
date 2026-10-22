from django.db import models
from django.db.models.functions import Lower

from api.models.photo import Photo
from api.models.scopes import OwnedQuerySet
from api.models.user import User

NAME_MAX_LENGTH = 100
# A circle from a garden to a small town.
RADIUS_MIN_M = 25
RADIUS_MAX_M = 2000
# The Places page lists them all in one row.
MAX_PLACES_PER_USER = 100


class UserPlaceIcon(models.TextChoices):
    """The icon a place shows with its name."""

    PIN = "pin", "Pin"
    HOME = "home", "Home"
    WORK = "work", "Work"
    SCHOOL = "school", "School"
    HEART = "heart", "Heart"
    STAR = "star", "Star"


class UserPlaceQuerySet(OwnedQuerySet["UserPlace"]):
    """Scoped to its owner through ``owner``. Never shared: no ``shared_to``."""


class UserPlace(models.Model):
    """A place the user named and drew (#1365): "Home", 150 m around a spot.

    A circle: ``radius_m`` around ``center_lat``/``center_lon``. ``photos``
    are the owner's photos taken inside it, kept by
    ``api.places.membership``; a photo inside two places is in the smaller
    one only. Private: a place called Home is the owner's home address, so
    neither its name nor its circle ever reaches another user, a shared or a
    public view. Not an ``AlbumPlace``, which shares, syncs and groups the
    "Shared with you" places by title.
    """

    name = models.CharField(max_length=NAME_MAX_LENGTH)
    icon = models.CharField(
        max_length=16, choices=UserPlaceIcon.choices, default=UserPlaceIcon.PIN
    )
    center_lat = models.FloatField()
    center_lon = models.FloatField()
    radius_m = models.PositiveIntegerField()
    # "Sunday at Home" instead of "Sunday in Munich" for an event taken there.
    use_in_titles = models.BooleanField(default=True)
    photos = models.ManyToManyField(Photo, related_name="user_places", blank=True)
    # Private: it goes with its owner rather than to ``deleted``.
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    objects = UserPlaceQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "owner", name="unique_user_place_name"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id or 0}: {self.name}"
