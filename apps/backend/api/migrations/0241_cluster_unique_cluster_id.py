"""One unknown face cluster per user.

``get_unknown_cluster`` is a ``get_or_create`` that had no unique constraint
behind it, so two face scans of one user's photos at once could each create
the unknown cluster (-1); every later scan then logged "Multiple clusters found
with id -1". The duplicates merge into the oldest one, which takes over their
faces, before the constraint goes on.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.models import Count, Min

UNKNOWN_CLUSTER_ID = -1


def merge_duplicate_clusters(
    apps: Apps, schema_editor: BaseDatabaseSchemaEditor
) -> None:
    Cluster = apps.get_model("api", "Cluster")
    Face = apps.get_model("api", "Face")
    duplicated = (
        Cluster.objects.filter(owner__isnull=False, cluster_id=UNKNOWN_CLUSTER_ID)
        .values("owner_id", "cluster_id")
        .annotate(rows=Count("id"), kept=Min("id"))
        .filter(rows__gt=1)
    )
    for group in duplicated:
        extra = Cluster.objects.filter(
            owner_id=group["owner_id"], cluster_id=group["cluster_id"]
        ).exclude(id=group["kept"])
        Face.objects.filter(cluster__in=extra).update(cluster_id=group["kept"])
        extra.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0240_photo_edit_face_boxes"),
    ]

    operations = [
        migrations.RunPython(merge_duplicate_clusters, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="cluster",
            constraint=models.UniqueConstraint(
                condition=models.Q(cluster_id=UNKNOWN_CLUSTER_ID),
                fields=("owner",),
                name="one unknown cluster per owner",
            ),
        ),
    ]
