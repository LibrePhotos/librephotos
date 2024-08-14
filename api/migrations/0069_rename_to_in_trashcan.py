from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0068_remove_longrunningjob_result_and_more"),
    ]

    operations = [
        migrations.RenameField(
            model_name="photo",
            old_name="deleted",
            new_name="in_trashcan",
        ),
    ]
