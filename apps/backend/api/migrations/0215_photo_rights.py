"""A photo's license and the rights a user gives their photos by default (#425)."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0214_user_scrubber_style'),
    ]

    operations = [
        migrations.AddField(
            model_name='photometadata',
            name='license',
            field=models.CharField(blank=True, choices=[('all-rights-reserved', 'All rights reserved'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('cc-by-nd-4.0', 'CC BY-ND 4.0'), ('cc-by-nc-nd-4.0', 'CC BY-NC-ND 4.0'), ('cc0-1.0', 'CC0 1.0'), ('pdm-1.0', 'Public Domain Mark 1.0')], max_length=32, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='default_copyright',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='user',
            name='default_creator',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='user',
            name='default_license',
            field=models.CharField(blank=True, choices=[('all-rights-reserved', 'All rights reserved'), ('cc-by-4.0', 'CC BY 4.0'), ('cc-by-sa-4.0', 'CC BY-SA 4.0'), ('cc-by-nc-4.0', 'CC BY-NC 4.0'), ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0'), ('cc-by-nd-4.0', 'CC BY-ND 4.0'), ('cc-by-nc-nd-4.0', 'CC BY-NC-ND 4.0'), ('cc0-1.0', 'CC0 1.0'), ('pdm-1.0', 'Public Domain Mark 1.0')], default='', max_length=32),
        ),
    ]
