"""Record which model produced a photo's semantic-search embedding.

NULL keeps meaning what every stored embedding was until now: CLIP ViT-B/32.
The default model becomes MobileCLIP-S2 (api.semantic_search); embeddings of
the other model are re-embedded in place by the Calculate CLIP embeddings
job, which the startup's build_similarity_index queues for such users.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0150_perf_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="clip_embeddings_model",
            field=models.CharField(blank=True, max_length=32, null=True),
        ),
    ]
