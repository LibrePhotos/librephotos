import json

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0006_migrate_to_boolean_field"),
    ]

    def forwards_func(apps, schema_editor):
        Photo = apps.get_model("api", "Photo")
        
        # Check if the image_path field exists in the database before trying to access it
        db_table = Photo._meta.db_table
        connection = schema_editor.connection
        
        # Use Django's database introspection (works with both SQLite and PostgreSQL)
        introspection = connection.introspection
        with connection.cursor() as cursor:
            columns = [col.name for col in introspection.get_table_description(cursor, db_table)]
        
        has_image_path = 'image_path' in columns
        
        if not has_image_path:
            print("image_path field not found in database. Skipping data migration.")
            print("This is normal if the database was created after the image_path field was removed.")
            return
        
        print(f"Found image_path field. Migrating {Photo.objects.count()} photos...")
        
        # Migrate data from image_path to image_paths
        migrated_count = 0
        error_count = 0
        
        for obj in Photo.objects.all():
            try:
                # Safely access the image_path field
                image_path = getattr(obj, 'image_path', None)
                if image_path:
                    # Initialize image_paths if it doesn't exist
                    if not hasattr(obj, 'image_paths') or obj.image_paths is None:
                        obj.image_paths = []
                    
                    # Add the image_path to image_paths if it's not already there
                    if image_path not in obj.image_paths:
                        obj.image_paths.append(image_path)
                        obj.save()
                        migrated_count += 1
                
            except AttributeError as e:
                print(f"AttributeError accessing image_path for photo {obj.image_hash}: {e}")
                error_count += 1
            except json.JSONDecodeError as e:
                print(f"Cannot convert {getattr(obj, 'image_path', 'unknown')} object: {e}")
                error_count += 1
            except Exception as e:
                print(f"Unexpected error migrating photo {obj.image_hash}: {e}")
                error_count += 1
        
        print(f"Migration completed. Migrated: {migrated_count}, Errors: {error_count}")

    def reverse_func(apps, schema_editor):
        """Reverse function to handle rollback if needed"""
        Photo = apps.get_model("api", "Photo")
        
        # Check if we have both fields during rollback
        db_table = Photo._meta.db_table
        connection = schema_editor.connection
        
        # Use Django's database introspection (works with both SQLite and PostgreSQL)
        introspection = connection.introspection
        with connection.cursor() as cursor:
            columns = [col.name for col in introspection.get_table_description(cursor, db_table)]
        
        has_image_path = 'image_path' in columns
        has_image_paths = 'image_paths' in columns
        
        if not has_image_path or not has_image_paths:
            print("Required fields not found for reverse migration. Skipping.")
            return
        
        # During rollback, copy the first image_paths entry back to image_path
        for obj in Photo.objects.all():
            try:
                if obj.image_paths and len(obj.image_paths) > 0:
                    obj.image_path = obj.image_paths[0]
                    obj.save()
            except Exception as e:
                print(f"Error during reverse migration for photo {obj.image_hash}: {e}")

    operations = [
        migrations.AddField(
            model_name="Photo",
            name="image_paths",
            field=models.JSONField(db_index=True, default=list),
        ),
        migrations.RunPython(forwards_func, reverse_func),
    ]
