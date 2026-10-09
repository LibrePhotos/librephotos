"""Turn off the public links of users deleted before 1.3.0.

Deleting a user hands their photos and albums to the disabled ``deleted``
account. Their public album links, photo links and public photos kept
working, and as nobody can sign in as ``deleted``, nobody could turn them off.
Deleting a user now turns them off first (``api.user_deletion``); this does the
same for what older versions left there.

Shares with other users of the instance are not touched. Running it again
finds nothing to change. Reversing does nothing: which links were on is not
kept, and serving them again is what this fixes.
"""

from django.db import migrations
from django.utils import timezone


def turn_off_public_links_of_deleted_users(apps, schema_editor):
    User = apps.get_model("api", "User")
    # The placeholder get_deleted_user() makes, which it always disables.
    deleted = User.objects.filter(username="deleted", is_active=False).first()
    if deleted is None:
        return
    AlbumUserShare = apps.get_model("api", "AlbumUserShare")
    PhotoShare = apps.get_model("api", "PhotoShare")
    Photo = apps.get_model("api", "Photo")
    AlbumUserShare.objects.filter(album__owner=deleted).update(enabled=False, slug=None)
    PhotoShare.objects.filter(photo__owner=deleted).update(enabled=False, slug=None)
    # last_modified: synced clients show whether a photo is public.
    Photo.objects.filter(owner=deleted, public=True).update(
        public=False, last_modified=timezone.now()
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0148_albumuser_locked"),
    ]

    operations = [
        migrations.RunPython(
            turn_off_public_links_of_deleted_users, migrations.RunPython.noop
        ),
    ]
