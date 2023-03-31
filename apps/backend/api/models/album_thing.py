from django.db import connection, models

from api.models.photo import Photo
from api.models.user import User, get_deleted_user


class AlbumThing(models.Model):
    title = models.CharField(max_length=512, db_index=True)
    photos = models.ManyToManyField(Photo)
    thing_type = models.CharField(max_length=512, db_index=True, null=True)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )

    shared_to = models.ManyToManyField(User, related_name="album_thing_shared_to")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["title", "thing_type", "owner"], name="unique AlbumThing"
            )
        ]

    def __str__(self):
        return "%d: %s" % (self.id, self.title)


def get_album_thing(title, owner):
    return AlbumThing.objects.get_or_create(title=title, owner=owner)[0]


# List all existing (thing / thing type / user)
view_api_album_thing_sql = """
    api_albumthing_sql as (
       select title, 'places365_attribute' thing_type, false favorited, owner_id
       from (select owner_id, jsonb_array_elements_text(jsonb_extract_path(captions_json,  'places365', 'attributes')) title from api_photo ) photo_attribut
       group by title, thing_type, favorited, owner_id
       union all
       select title, 'places365_category' thing_type, false favorited, owner_id
       from (select owner_id, jsonb_array_elements_text(jsonb_extract_path(captions_json,  'places365', 'categories')) title from api_photo ) photo_attribut
       group by title, thing_type, favorited, owner_id
    )"""

# List all photos per albumThing
view_api_album_thing_photos_sql = """
    api_albumthing_photos_sql as (
       select api_albumthing.id albumthing_id, photo_id
       from (select owner_id, jsonb_array_elements_text(jsonb_extract_path(captions_json,  'places365', 'attributes')) title, image_hash photo_id, 'places365_attribute' thing_type from api_photo ) photo_attribut
       join api_albumthing using (title,thing_type, owner_id )
       group by api_albumthing.id, photo_id
       union all
       select api_albumthing.id albumthing_id, photo_id
       from (select owner_id, jsonb_array_elements_text(jsonb_extract_path(captions_json,  'places365', 'categories')) title, image_hash photo_id, 'places365_category' thing_type from api_photo ) photo_attribut
       join api_albumthing using (title,thing_type, owner_id )
       group by api_albumthing.id, photo_id
    )
"""


def create_new_album_thing(cursor):
    """This function create albums from all detected thing on photos"""
    SQL = """
        with {}
        insert into api_albumthing (title, thing_type,favorited, owner_id)
        select api_albumthing_sql.*
        from api_albumthing_sql
        left join api_albumthing using (title, thing_type, owner_id)
        where  api_albumthing is null;
    """.replace(
        "{}", view_api_album_thing_sql
    )
    cursor.execute(SQL)


def create_new_album_thing_photo(cursor):
    """This function create link between albums thing and photo from all detected thing on photos"""
    SQL = """
        with {}
        insert into api_albumthing_photos (albumthing_id, photo_id)
        select api_albumthing_photos_sql.*
        from api_albumthing_photos_sql
        left join api_albumthing_photos using (albumthing_id, photo_id)
        where  api_albumthing_photos is null;
    """.replace(
        "{}", view_api_album_thing_photos_sql
    )
    cursor.execute(SQL)


def delete_album_thing_photo(cursor):
    """This function delete photos form albums thing where thing disappears"""
    SQL = """
        with {}
        delete
        from api_albumthing_photos as p
        where not exists (
            select 1
            from api_albumthing_photos_sql
            where albumthing_id = p.albumthing_id
                and photo_id = p.photo_id
            limit 1
        )
    """.replace(
        "{}", view_api_album_thing_photos_sql
    )
    cursor.execute(SQL)


def delete_album_thing(cursor):
    """This function delete albums thing without photos"""
    SQL = """
        with {}
        delete from api_albumthing
        where (title, thing_type, owner_id) not in ( select title, thing_type, owner_id from api_albumthing_sql );
    """.replace(
        "{}", view_api_album_thing_sql
    )
    cursor.execute(SQL)


def update():
    with connection.cursor() as cursor:
        create_new_album_thing(cursor)
        create_new_album_thing_photo(cursor)
        delete_album_thing_photo(cursor)
        delete_album_thing(cursor)
