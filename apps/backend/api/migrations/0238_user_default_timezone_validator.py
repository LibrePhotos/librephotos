"""``User.default_timezone`` is checked by a validator instead of ``choices``.

The names are the same (``api.metadata.time_zones.ALL_TIME_ZONES``, the list
pytz gave), but they now follow the pinned tzdata package, so a tzdata update
needs no migration. No SQL: no row changes.
"""

from django.db import migrations, models

import api.models.user


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0237_category_source_choices"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="default_timezone",
            field=models.TextField(
                default="UTC", validators=[api.models.user.validate_time_zone]
            ),
        ),
    ]
