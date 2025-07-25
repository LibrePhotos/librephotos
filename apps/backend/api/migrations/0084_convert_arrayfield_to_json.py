# Migration to safely convert ArrayField to JSONField for SQLite compatibility
from django.db import migrations, models


def copy_arrayfield_to_json(apps, schema_editor):
    """
    Copy data from ArrayField to JSONField format.
    This handles the conversion for both PostgreSQL and SQLite.
    """
    Photo = apps.get_model('api', 'Photo')
    
    for photo in Photo.objects.all():
        if photo.clip_embeddings is not None:
            # ArrayField data is already in list format, just copy it
            photo.clip_embeddings_json = photo.clip_embeddings
            photo.save(update_fields=['clip_embeddings_json'])


def copy_json_to_arrayfield(apps, schema_editor):
    """
    Reverse migration: copy JSONField data back to ArrayField format.
    """
    Photo = apps.get_model('api', 'Photo')
    
    for photo in Photo.objects.all():
        if photo.clip_embeddings_json is not None:
            photo.clip_embeddings = photo.clip_embeddings_json
            photo.save(update_fields=['clip_embeddings'])


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0083_remove_search_fields'),
    ]

    operations = [
        # Step 1: Add new JSONField
        migrations.AddField(
            model_name='Photo',
            name='clip_embeddings_json',
            field=models.JSONField(blank=True, null=True),
        ),
        
        # Step 2: Copy data from ArrayField to JSONField
        migrations.RunPython(
            copy_arrayfield_to_json,
            copy_json_to_arrayfield,
        ),
        
        # Step 3: Remove old ArrayField
        migrations.RemoveField(
            model_name='Photo',
            name='clip_embeddings',
        ),
        
        # Step 4: Rename JSONField to original name
        migrations.RenameField(
            model_name='Photo',
            old_name='clip_embeddings_json',
            new_name='clip_embeddings',
        ),
    ] 