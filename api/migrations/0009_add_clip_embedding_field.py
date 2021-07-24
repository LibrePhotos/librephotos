from django.db import migrations, models
from django.contrib.postgres.fields import ArrayField

from api.semantic_search.semantic_search import semantic_search_instance

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_remove_image_path'),
    ]

    operations = [    
        migrations.AddField(
            model_name='Photo',
            name='clip_embeddings',
            field= ArrayField(models.FloatField(blank=True, null=True), size=512, null=True)
        ),
        migrations.AddField(
            model_name='Photo',
            name='clip_embeddings_magnitude',
            field= models.FloatField(blank=True, null=True)
        ),
        migrations.AddField(
            model_name='User',
            name='semantic_search_topk',
            field= models.IntegerField(default=0, null=False)
        )
    ]