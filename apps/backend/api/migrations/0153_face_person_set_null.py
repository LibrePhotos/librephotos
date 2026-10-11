"""Face.person is on_delete=SET_NULL instead of DO_NOTHING.

A post_delete receiver on Person used to null the faces of a deleted person;
Django's delete collector now does it as part of the delete. Python-side
only: on_delete is not part of the column, so this writes no SQL.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0152_openclip_only"),
    ]

    operations = [
        migrations.AlterField(
            model_name="face",
            name="person",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="faces",
                to="api.person",
            ),
        ),
    ]
