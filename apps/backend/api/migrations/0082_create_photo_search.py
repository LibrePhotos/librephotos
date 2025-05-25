# Generated migration for PhotoSearch model

from django.db import migrations, models
import django.db.models.deletion


def migrate_search_data(apps, schema_editor):
    """Migrate existing search data from Photo and PhotoCaption to PhotoSearch"""
    Photo = apps.get_model('api', 'Photo')
    PhotoCaption = apps.get_model('api', 'PhotoCaption')
    PhotoSearch = apps.get_model('api', 'PhotoSearch')
    
    db_alias = schema_editor.connection.alias
    
    # Create PhotoSearch instances for all photos that have search data
    photos_with_search_data = Photo.objects.using(db_alias).filter(
        search_location__isnull=False
    ).exclude(search_location='')
    
    search_instances_to_create = []
    
    for photo in photos_with_search_data.iterator():
        search_instances_to_create.append(
            PhotoSearch(
                photo=photo,
                search_location=photo.search_location,
                search_captions=''  # Will be populated later
            )
        )
    
    # Bulk create PhotoSearch instances
    PhotoSearch.objects.using(db_alias).bulk_create(search_instances_to_create, ignore_conflicts=True)
    
    # Now migrate search_captions from PhotoCaption to PhotoSearch
    for caption in PhotoCaption.objects.using(db_alias).filter(search_captions__isnull=False).exclude(search_captions=''):
        search_instance, created = PhotoSearch.objects.using(db_alias).get_or_create(
            photo=caption.photo,
            defaults={'search_captions': caption.search_captions, 'search_location': ''}
        )
        if not created:
            search_instance.search_captions = caption.search_captions
            search_instance.save()


def reverse_migrate_search_data(apps, schema_editor):
    """Reverse migration - copy data back from PhotoSearch to Photo and PhotoCaption"""
    Photo = apps.get_model('api', 'Photo')
    PhotoCaption = apps.get_model('api', 'PhotoCaption')
    PhotoSearch = apps.get_model('api', 'PhotoSearch')
    
    db_alias = schema_editor.connection.alias
    
    # Update photos with search_location from PhotoSearch instances
    for search in PhotoSearch.objects.using(db_alias).all():
        try:
            photo = Photo.objects.using(db_alias).get(image_hash=search.photo_id)
            photo.search_location = search.search_location
            photo.save(update_fields=['search_location'])
            
            # Update PhotoCaption with search_captions
            caption, created = PhotoCaption.objects.using(db_alias).get_or_create(photo=photo)
            caption.search_captions = search.search_captions
            caption.save(update_fields=['search_captions'])
        except Photo.DoesNotExist:
            continue


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0081_remove_caption_fields_from_photo'),
    ]

    operations = [
        migrations.CreateModel(
            name='PhotoSearch',
            fields=[
                ('photo', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='search_instance', serialize=False, to='api.photo')),
                ('search_captions', models.TextField(blank=True, db_index=True, null=True)),
                ('search_location', models.TextField(blank=True, db_index=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'api_photo_search',
            },
        ),
        migrations.RunPython(
            migrate_search_data,
            reverse_migrate_search_data,
        ),
    ] 