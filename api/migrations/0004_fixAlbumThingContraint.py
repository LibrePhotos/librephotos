api/migrations/0004_fixAlbumThingContraint.py 

from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_remove_unused_thumbs'),
    ]

    operations = [    
        migrations.AlterUniqueTogether(
            name='albumthing',
            unique_together=set([]),
        ),
        migrations.AddConstraint(
            model_name="albumthing",
            constraint=models.UniqueConstraint(
               fields=['room', 'date'],
                name="unique AlbumThing",
            ),
        ),
    ]
