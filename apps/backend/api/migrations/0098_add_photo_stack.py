# Generated migration for PhotoStack unified grouping system

import uuid
from django.db import migrations, models
import django.db.models.deletion


def get_deleted_user():
    """Reference to the function that returns the deleted user placeholder."""
    from api.models.user import get_deleted_user as _get_deleted_user
    return _get_deleted_user


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0097_add_duplicate_detection_settings_to_user'),
    ]

    operations = [
        # Create the PhotoStack table
        migrations.CreateModel(
            name='PhotoStack',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('stack_type', models.CharField(
                    choices=[
                        ('exact_copy', 'Exact Copies'),
                        ('visual_duplicate', 'Visual Duplicates'),
                        ('raw_jpeg', 'RAW + JPEG Pair'),
                        ('burst', 'Burst Sequence'),
                        ('bracket', 'Exposure Bracket'),
                        ('live_photo', 'Live Photo'),
                        ('manual', 'Manual Stack'),
                    ],
                    db_index=True,
                    default='visual_duplicate',
                    max_length=20,
                )),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pending Review'),
                        ('reviewed', 'Reviewed'),
                        ('dismissed', 'Dismissed'),
                    ],
                    db_index=True,
                    default='pending',
                    max_length=20,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('similarity_score', models.FloatField(blank=True, null=True)),
                ('sequence_start', models.DateTimeField(blank=True, null=True)),
                ('sequence_end', models.DateTimeField(blank=True, null=True)),
                ('potential_savings', models.BigIntegerField(default=0)),
                ('owner', models.ForeignKey(
                    on_delete=django.db.models.deletion.SET(get_deleted_user),
                    related_name='photo_stacks',
                    to='api.user',
                )),
                ('primary_photo', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='primary_in_stack',
                    to='api.photo',
                )),
            ],
            options={
                'verbose_name': 'Photo Stack',
                'verbose_name_plural': 'Photo Stacks',
                'ordering': ['-created_at'],
            },
        ),
        # Add indexes for PhotoStack
        migrations.AddIndex(
            model_name='photostack',
            index=models.Index(fields=['owner', 'stack_type', 'status'], name='api_photost_owner_i_abc123_idx'),
        ),
        migrations.AddIndex(
            model_name='photostack',
            index=models.Index(fields=['owner', 'status'], name='api_photost_owner_i_def456_idx'),
        ),
        # Add stack field to Photo
        migrations.AddField(
            model_name='photo',
            name='stack',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='photos',
                to='api.photostack',
            ),
        ),
        # Add sub-second timestamp for burst detection
        migrations.AddField(
            model_name='photo',
            name='exif_timestamp_subsec',
            field=models.CharField(blank=True, max_length=10, null=True),
        ),
        # Add image sequence number for burst detection
        migrations.AddField(
            model_name='photo',
            name='image_sequence_number',
            field=models.IntegerField(blank=True, null=True),
        ),
        # Remove duplicate_group FK from Photo (replaced by stack)
        migrations.RemoveField(
            model_name='photo',
            name='duplicate_group',
        ),
        # Delete the old DuplicateGroup model
        migrations.DeleteModel(
            name='DuplicateGroup',
        ),
    ]
