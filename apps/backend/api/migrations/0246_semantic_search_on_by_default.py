from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

SEMANTIC_SEARCH_TOPK = 100


def turn_semantic_search_on(
    apps: Apps, schema_editor: BaseDatabaseSchemaEditor
) -> None:
    User = apps.get_model("api", "User")
    User.objects.filter(semantic_search_topk=0).update(
        semantic_search_topk=SEMANTIC_SEARCH_TOPK
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0245_photoshare_expires_at"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="semantic_search_topk",
            field=models.IntegerField(default=SEMANTIC_SEARCH_TOPK),
        ),
        migrations.RunPython(turn_semantic_search_on, migrations.RunPython.noop),
    ]
