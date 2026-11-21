from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0157_move_scheduled_photo_functions"),
    ]

    operations = [migrations.RunPython(migrations.RunPython.noop, migrations.RunPython.noop)]
