from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [    
        migrations.AddField(
            model_name='User',
            name='confidence',
            field= models.FloatField(default=0.1, db_index=True)
        )
    ]
