# Data migration to set stack_raw_jpeg based on skip_raw_files
# If skip_raw_files was True (skip RAWs), then stack_raw_jpeg should be False (don't stack)
# If skip_raw_files was False (don't skip RAWs), then stack_raw_jpeg should be True (stack them)

from django.db import migrations


def migrate_skip_raw_to_stack_raw_jpeg(apps, schema_editor):
    User = apps.get_model("api", "User")
    # Set stack_raw_jpeg = not skip_raw_files
    # If user was skipping RAW files, they probably don't want them stacked
    # If user was not skipping RAW files, enable stacking by default
    User.objects.filter(skip_raw_files=True).update(stack_raw_jpeg=False)
    User.objects.filter(skip_raw_files=False).update(stack_raw_jpeg=True)


def reverse_migration(apps, schema_editor):
    # Reverse migration: set skip_raw_files based on stack_raw_jpeg
    User = apps.get_model("api", "User")
    User.objects.filter(stack_raw_jpeg=False).update(skip_raw_files=True)
    User.objects.filter(stack_raw_jpeg=True).update(skip_raw_files=False)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0108_add_stack_raw_jpeg_field"),
    ]

    operations = [
        migrations.RunPython(migrate_skip_raw_to_stack_raw_jpeg, reverse_migration),
    ]


