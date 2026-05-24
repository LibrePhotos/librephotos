import picklefield.fields
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0009_auto_20171009_0915"),
    ]

    operations = [
        migrations.AlterField(
            model_name="task",
            name="args",
            field=picklefield.fields.PickledObjectField(
                editable=False, null=True, protocol=-1
            ),
        ),
        migrations.AlterField(
            model_name="task",
            name="kwargs",
            field=picklefield.fields.PickledObjectField(
                editable=False, null=True, protocol=-1
            ),
        ),
        migrations.AlterField(
            model_name="task",
            name="result",
            field=picklefield.fields.PickledObjectField(
                editable=False, null=True, protocol=-1
            ),
        ),
    ]
