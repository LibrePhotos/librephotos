from django.db import migrations


def move_person_to_cluster_if_kind_cluster(apps, schema_editor):
    # Get the necessary models
    Face = apps.get_model("api", "Face")

    # Define the constant for KIND_CLUSTER
    KIND_CLUSTER = "CLUSTER"

    # Fetch all Face instances where person is not null
    faces_to_update = Face.objects.filter(person__isnull=False)

    # Iterate over the faces and process each one
    for face in faces_to_update:
        # Check if the person is of type KIND_CLUSTER
        if face.person.kind == KIND_CLUSTER:
            # Move the person to the cluster field and set the person field to null
            face.cluster_person = face.person
            face.person = None
            face.save()


def restore_person_from_cluster(apps, schema_editor):
    # Get the necessary models
    Face = apps.get_model("api", "Face")

    # Fetch all Face instances where original_person_id is not null (from forward migration)
    faces_to_restore = Face.objects.filter(cluster_person__isnull=False)

    # Iterate over the faces and restore the person reference from the original_person_id field
    for face in faces_to_restore:
        face.person = face.cluster_person
        face.cluster_person = None
        face.save()


class Migration(migrations.Migration):
    dependencies = [
        (
            "api",
            "0073_remove_unknown_person",
        ),
    ]

    operations = [
        migrations.RunPython(
            move_person_to_cluster_if_kind_cluster,
            restore_person_from_cluster,
        ),
    ]
