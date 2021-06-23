from django.db import migrations, models
from django.contrib.postgres.fields import ArrayField

from api.semantic_search.semantic_search import semantic_search_instance

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_remove_image_path'),
    ]

    def forwards_func(apps, schema):
        Photo = apps.get_model('api', 'Photo')
        for obj in Photo.objects.all():
            try:
                image_path = obj.image_paths[0]
                img_emb, magnitutde = semantic_search_instance.calculate_clip_embeddings(image_path)
                obj.clip_embeddings = img_emb
                obj.clip_embeddings_magnitutde = magnitutde
                obj.save()
            except Exception as e:
                print(e)
                print('Cannot convert {} object'.format(obj.image_paths[0]))

    def reverse_func(apps, schema_editor):
        pass

    operations = [    
        migrations.AddField(
            model_name='Photo',
            name='clip_embeddings',
            field= ArrayField(models.FloatField(blank=True, null=True), size=512, null=True)
        ),
        migrations.AddField(
            model_name='Photo',
            name='clip_embeddings_magnitutde',
            field= models.FloatField(blank=True, null=True)
        ),
        migrations.RunPython(forwards_func, reverse_func),
    ]