"""Further library folders of a user, beside the scan directory (#123)."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0203_photometadata_edited_keywords'),
    ]

    operations = [
        migrations.CreateModel(
            name='LibraryFolder',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('path', models.CharField(max_length=512)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='library_folders', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'constraints': [models.UniqueConstraint(models.F('owner'), models.F('path'), name='unique_library_folder_per_owner')],
            },
        ),
    ]
