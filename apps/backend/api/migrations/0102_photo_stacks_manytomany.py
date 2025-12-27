"""
Migration to convert Photo.stack ForeignKey to Photo.stacks ManyToManyField.

This change allows a photo to belong to multiple stacks of different types
simultaneously, preventing data loss when photos have multiple relationships:
- A RAW+JPEG pair can also be visually similar to other photos
- A burst sequence can also have exact copies
- etc.
"""

from django.db import migrations, models


def migrate_fk_to_m2m(apps, schema_editor):
    """
    Migrate existing ForeignKey relationships to ManyToMany.
    
    For each photo that has a stack ForeignKey set, add that stack
    to the new ManyToMany relationship.
    """
    Photo = apps.get_model('api', 'Photo')
    
    # Get all photos with a stack set (using the old FK field)
    photos_with_stacks = Photo.objects.filter(stack__isnull=False).select_related('stack')
    
    for photo in photos_with_stacks:
        # Add the old FK stack to the new M2M relationship
        photo.stacks.add(photo.stack)


def reverse_m2m_to_fk(apps, schema_editor):
    """
    Reverse migration: convert ManyToMany back to ForeignKey.
    
    For each photo, set the FK to the first stack in the M2M relationship.
    Note: This may lose data if a photo was in multiple stacks.
    """
    Photo = apps.get_model('api', 'Photo')
    
    for photo in Photo.objects.prefetch_related('stacks').all():
        first_stack = photo.stacks.first()
        if first_stack:
            photo.stack = first_stack
            photo.save(update_fields=['stack'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0101_populate_photo_metadata'),
    ]

    operations = [
        # Step 1: Add the new ManyToMany field
        migrations.AddField(
            model_name='photo',
            name='stacks',
            field=models.ManyToManyField(
                blank=True,
                related_name='photos_m2m',
                to='api.photostack',
            ),
        ),
        
        # Step 2: Migrate data from FK to M2M
        migrations.RunPython(
            migrate_fk_to_m2m,
            reverse_m2m_to_fk,
        ),
        
        # Step 3: Remove the old ForeignKey field
        migrations.RemoveField(
            model_name='photo',
            name='stack',
        ),
        
        # Step 4: Rename M2M related_name to final name
        migrations.AlterField(
            model_name='photo',
            name='stacks',
            field=models.ManyToManyField(
                blank=True,
                related_name='photos',
                to='api.photostack',
            ),
        ),
    ]
