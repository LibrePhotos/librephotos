from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0077_alter_albumdate_title'),
    ]

    operations = [
        migrations.CreateModel(
            name='Thumbnail',
            fields=[
                ('photo', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='thumbnail', serialize=False, to='api.photo')),
                ('thumbnail_big', models.ImageField(upload_to='thumbnails_big')),
                ('square_thumbnail', models.ImageField(upload_to='square_thumbnails')),
                ('square_thumbnail_small', models.ImageField(upload_to='square_thumbnails_small')),
                ('aspect_ratio', models.FloatField(blank=True, null=True)),
                ('dominant_color', models.TextField(blank=True, null=True)),
            ],
        ),
        migrations.RunSQL(
            sql=[
                """
                INSERT INTO api_thumbnail (
                    photo_id,
                    thumbnail_big,
                    square_thumbnail,
                    square_thumbnail_small,
                    aspect_ratio,
                    dominant_color
                )
                SELECT 
                    image_hash,
                    thumbnail_big,
                    square_thumbnail,
                    square_thumbnail_small,
                    aspect_ratio,
                    dominant_color
                FROM api_photo
                """
            ],
            reverse_sql=[
                """
                UPDATE api_photo p
                SET 
                    thumbnail_big = pt.thumbnail_big,
                    square_thumbnail = pt.square_thumbnail,
                    square_thumbnail_small = pt.square_thumbnail_small,
                    aspect_ratio = pt.aspect_ratio,
                    dominant_color = pt.dominant_color
                FROM api_thumbnail pt
                WHERE p.image_hash = pt.photo_id
                """
            ]
        ),
        migrations.RemoveField(
            model_name='photo',
            name='aspect_ratio',
        ),
        migrations.RemoveField(
            model_name='photo',
            name='dominant_color',
        ),
        migrations.RemoveField(
            model_name='photo',
            name='square_thumbnail',
        ),
        migrations.RemoveField(
            model_name='photo',
            name='square_thumbnail_small',
        ),
        migrations.RemoveField(
            model_name='photo',
            name='thumbnail_big',
        ),
    ] 