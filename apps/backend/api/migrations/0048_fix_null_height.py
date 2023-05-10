from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0047_alter_file_embedded_media"),
    ]

    operations = [
        migrations.RunSQL("UPDATE api_photo SET height=0 WHERE height IS NULL;")
    ]
