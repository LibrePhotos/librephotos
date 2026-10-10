from django.db import connection, models, transaction

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class AlbumDate(models.Model):
    title = models.CharField(blank=True, default="", max_length=512, db_index=True)
    date = models.DateField(db_index=True, null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    location = models.JSONField(blank=True, db_index=True, null=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    shared_to = models.ManyToManyField(User, related_name="album_date_shared_to")
    objects = models.Manager()

    class Meta:
        unique_together = ("date", "owner")

    def __str__(self):
        return str(self.date) + " (" + str(self.owner) + ")"

    def ordered_photos(self):
        return self.photos.all().order_by("-exif_timestamp")


# pg_advisory_xact_lock(namespace, owner id) for the undated album.
_UNDATED_ALBUM_LOCK = 0x4C500001


def _get_or_create_undated_album(owner):
    """The owner's album for photos without a date, created once.

    unique_together does not hold for ``date=NULL`` (NULLs are distinct), so
    scan workers reaching undated files at the same moment each created one.
    The scan queues video groups first, and videos are often the undated
    files, so that became the rule rather than a rare race. On PostgreSQL the
    creation is serialized per owner; SQLite keeps the old behaviour.
    """
    with transaction.atomic():
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(%s, %s)",
                    [_UNDATED_ALBUM_LOCK, owner.pk],
                )
        album = AlbumDate.objects.filter(date=None, owner=owner).order_by("pk").first()
        if album is None:
            album = AlbumDate.objects.create(date=None, owner=owner)
    return album


def get_or_create_album_date(date, owner):
    if date is None:
        return _get_or_create_undated_album(owner)
    try:
        return AlbumDate.objects.get_or_create(date=date, owner=owner)[0]
    except AlbumDate.MultipleObjectsReturned:
        return AlbumDate.objects.filter(date=date, owner=owner).first()


def get_album_date(date, owner):
    try:
        return AlbumDate.objects.get(date=date, owner=owner)
    except Exception:
        return None


def get_album_nodate(owner):
    return _get_or_create_undated_album(owner)
