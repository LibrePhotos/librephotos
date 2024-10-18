from django.db import migrations


def delete_unknown_person_and_update_faces(apps, schema_editor):
    # Get models
    Person = apps.get_model("api", "Person")
    Face = apps.get_model("api", "Face")

    # Define the name for unknown persons
    unknown_person_name = "Unknown - Other"

    # Find all persons with the name "Unknown - Other"
    unknown_persons = Person.objects.filter(name=unknown_person_name)

    # Iterate through each unknown person and set faces' person field to null
    for unknown_person in unknown_persons:
        # Set all faces' person field referencing the "Unknown - Other" person to null
        Face.objects.filter(person=unknown_person).update(person=None)

        # Delete the "Unknown - Other" person
        unknown_person.delete()


def recreate_unknown_person_and_restore_faces(apps, schema_editor):
    # Get models
    Person = apps.get_model("api", "Person")
    Face = apps.get_model("api", "Face")
    User = apps.get_model("api", "User")

    # Define the name for unknown persons
    unknown_person_name = "Unknown - Other"

    # Retrieve all users to recreate their unknown persons
    users = User.objects.all()

    for user in users:
        # Recreate the "Unknown - Other" person for each user
        unknown_person = Person.objects.create(
            name=unknown_person_name, kind=Person.KIND_UNKNOWN, cluster_owner=user
        )

        # Restore faces for each recreated person based on user ownership
        Face.objects.filter(person=None, photo__owner=user).update(
            person=unknown_person
        )


class Migration(migrations.Migration):
    dependencies = [
        (
            "api",
            "0072_alter_face_person",
        ),
    ]

    operations = [
        migrations.RunPython(
            delete_unknown_person_and_update_faces,
            recreate_unknown_person_and_restore_faces,
        ),
    ]
