from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0156_drop_user_face_recognition_model_and_stackreview"),
    ]

    operations = [migrations.RunPython(migrations.RunPython.noop, migrations.RunPython.noop)]
