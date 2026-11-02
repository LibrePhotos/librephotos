"""The support prompts' per-user state: the thank-you dialog and Rewind."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0220_face_unmatched_by"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="support_prompt_seen",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="rewind_seen_year",
            field=models.IntegerField(default=0),
        ),
    ]
