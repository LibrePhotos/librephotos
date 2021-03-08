from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_remove_unused_thumbs'),
    ]

    operations = [    
        migrations.AlterUniqueTogether(
            name='albumthing',
            unique_together={('title', 'thing_type' , 'owner')},
        )
    ]
