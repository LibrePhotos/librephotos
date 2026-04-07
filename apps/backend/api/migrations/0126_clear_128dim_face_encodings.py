"""
Migration to clear face encodings that were generated with the old 128-dimension
face recognition model. After switching to ArcFace (512-dimension), any faces that
still have 128-dimension encodings (hex string length 2048) are incompatible and
must be re-encoded. Clusters are also deleted since they will be rebuilt on the next
face classification run.
"""

from django.db import migrations


# 128 floats * 8 bytes/float * 2 hex chars/byte = 2048 hex chars
ENCODING_128DIM_HEX_LENGTH = 2048


def clear_128dim_face_encodings(apps, schema_editor):
    """Clear Face encodings with 128-dim length and delete all Clusters."""
    Face = apps.get_model("api", "Face")
    Cluster = apps.get_model("api", "Cluster")

    faces_to_clear = [
        face
        for face in Face.objects.exclude(encoding="").only("id", "encoding")
        if len(face.encoding) == ENCODING_128DIM_HEX_LENGTH
    ]
    for face in faces_to_clear:
        face.encoding = ""
    Face.objects.bulk_update(faces_to_clear, ["encoding"])

    # Delete all clusters; they will be rebuilt on next face classification run
    deleted, _ = Cluster.objects.all().delete()


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
