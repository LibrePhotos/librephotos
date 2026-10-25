"""The cover photos of album and tag cards: a few of each album's visible photos.

Not a sliced ``Prefetch``: Django answers ``Prefetch("photos",
queryset=photos[:4])`` with ``ROW_NUMBER() OVER (PARTITION BY album)`` over
every photo of every listed album, joined to the photos and their thumbnails.
On a 158k-photo library that is 1.26M tag links and a parallel hash join
whose hash table, about 25 MB, lives in Postgres' dynamic shared memory:
Docker's 64 MB ``/dev/shm`` ran out when a few of those ran at once (#2868).

Here each album asks for its first photos on its own, ``ORDER BY photo_id
LIMIT 1 OFFSET k`` on the through table's ``(album, photo)`` unique index,
which stops after the first visible ones: a few index lookups per album and
no hash table, then one query loads the photos.
"""

from collections.abc import Sequence

from django.db.models import ManyToManyField, Model, OuterRef, Subquery

from api.models import Photo
from api.models.photo import visible_photo_q

COVER_PHOTO_COUNT = 4


def attach_cover_photos(
    albums: Sequence[Model],
    to_attr: str,
    relation: str = "photos",
    count: int = COVER_PHOTO_COUNT,
) -> None:
    """Set ``to_attr`` on each of ``albums`` to up to ``count`` of its visible
    photos (``Photo.visible``), loading only ``image_hash`` and ``video``.

    ``relation`` names the albums' many-to-many field to the photos. The
    covers are the album's first visible photos by id: any few would do, as
    the sliced prefetch this replaces had no order either.
    """
    if not albums:
        return
    model = type(albums[0])
    field = model._meta.get_field(relation)
    assert isinstance(field, ManyToManyField)
    through = field.remote_field.through
    assert through is not None
    album_fk = field.m2m_field_name()
    photo_fk = field.m2m_reverse_field_name()

    first_visible = (
        through._default_manager.filter(**{album_fk: OuterRef("pk")})
        .filter(visible_photo_q(f"{photo_fk}__"))
        .order_by(f"{photo_fk}_id")
        .values(f"{photo_fk}_id")
    )
    slots = [f"_cover_{k}" for k in range(count)]
    rows = (
        model._default_manager.filter(pk__in=[album.pk for album in albums])
        .annotate(
            **{slot: Subquery(first_visible[k : k + 1]) for k, slot in enumerate(slots)}
        )
        .values_list("pk", *slots)
    )
    # SQLite answers the subqueries with the stored hex, not a UUID.
    to_pk = Photo._meta.pk.to_python
    cover_ids = {pk: [to_pk(i) for i in ids if i is not None] for pk, *ids in rows}
    photos = Photo.objects.only("image_hash", "video").in_bulk(
        [i for ids in cover_ids.values() for i in ids]
    )
    for album in albums:
        ids = cover_ids.get(album.pk, [])
        setattr(album, to_attr, [photos[i] for i in ids if i in photos])
