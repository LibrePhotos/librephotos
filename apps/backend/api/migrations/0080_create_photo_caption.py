# Generated migration for PhotoCaption model

from django.db import migrations, models
import django.db.models.deletion


def migrate_caption_data(apps, schema_editor):
    """Migrate existing caption data from Photo to PhotoCaption"""
    Photo = apps.get_model('api', 'Photo')
    PhotoCaption = apps.get_model('api', 'PhotoCaption')
    
    db_alias = schema_editor.connection.alias
    
    # Create PhotoCaption instances for all photos that have caption data
    photos_with_captions = Photo.objects.using(db_alias).filter(
        models.Q(captions_json__isnull=False) | models.Q(search_captions__isnull=False)
    ).exclude(captions_json={})
    
    captions_to_create = []
    
    for photo in photos_with_captions.iterator():
        captions_to_create.append(
            PhotoCaption(
                photo_id=photo.image_hash,
                captions_json=photo.captions_json,
                search_captions=photo.search_captions
            )
        )
        
        # Process in batches to avoid memory issues
        if len(captions_to_create) >= 1000:
            PhotoCaption.objects.using(db_alias).bulk_create(captions_to_create, ignore_conflicts=True)
            captions_to_create = []
    
    # Create remaining captions
    if captions_to_create:
        PhotoCaption.objects.using(db_alias).bulk_create(captions_to_create, ignore_conflicts=True)


def reverse_migrate_caption_data(apps, schema_editor):
    """Reverse migration - copy data back from PhotoCaption to Photo"""
    Photo = apps.get_model('api', 'Photo')
    PhotoCaption = apps.get_model('api', 'PhotoCaption')
    
    db_alias = schema_editor.connection.alias
    
    # Update photos with caption data from PhotoCaption instances
    for caption in PhotoCaption.objects.using(db_alias).all():
        try:
            photo = Photo.objects.using(db_alias).get(image_hash=caption.photo_id)
            photo.captions_json = caption.captions_json
            photo.search_captions = caption.search_captions
            photo.save(update_fields=['captions_json', 'search_captions'])
        except Photo.DoesNotExist:
            continue


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0079_alter_albumauto_title'),
    ]

    operations = [
        migrations.CreateModel(
            name='PhotoCaption',
            fields=[
                ('photo', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='caption_instance', serialize=False, to='api.photo')),
                ('captions_json', models.JSONField(blank=True, db_index=True, null=True)),
                ('search_captions', models.TextField(blank=True, db_index=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'api_photo_caption',
            },
        ),
        migrations.RunPython(
            migrate_caption_data,
            reverse_migrate_caption_data,
        ),
    ] 