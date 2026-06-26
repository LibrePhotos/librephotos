"""
Migration to clear face encodings that were generated with the old 128-dimension
face recognition model. After switching to ArcFace (512-dimension), any faces that
still have 128-dimension encodings (hex string length 2048) are incompatible and
must be re-encoded. Clusters are also deleted since they will be rebuilt on the next
face classification run.
"""

from django.db import migrations
from django.db.models.functions import Length


# 128 floats * 8 bytes/float * 2 hex chars/byte = 2048 hex chars
ENCODING_128DIM_HEX_LENGTH = 2048


def clear_128dim_face_encodings(apps, schema_editor):
    """Clear Face encodings with 128-dim length and delete all Clusters."""
    Face = apps.get_model("api", "Face")
    Cluster = apps.get_model("api", "Cluster")

    # Clear in a single set-based UPDATE. The previous implementation loaded every
    # matching Face into memory and handed them all to bulk_update() with no
    # batch_size, which emits one
    #     UPDATE api_face SET encoding = CASE WHEN id=.. THEN '' ... END
    # with one branch per row. On large libraries (100k+ faces) evaluating that
    # CASE is roughly O(n^2) and pins a CPU core for hours; the equivalent
    # set-based UPDATE below runs in seconds.
    Face.objects.annotate(encoding_length=Length("encoding")).filter(
        encoding_length=ENCODING_128DIM_HEX_LENGTH
    ).update(encoding="")

    # Delete all clusters; they will be rebuilt on next face classification run
    Cluster.objects.all().delete()


def reverse_migration(apps, schema_editor):
    """No-op: cannot restore cleared encodings."""
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0125_add_default_face_recognition_model"),
    ]

    operations = [
        migrations.RunPython(
            clear_128dim_face_encodings,
            reverse_migration,
        ),
    ]
