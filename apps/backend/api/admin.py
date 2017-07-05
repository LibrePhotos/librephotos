from django.contrib import admin

# Register your models here.

from .models import (Photo, Person, Face, AlbumAuto, AlbumUser)

admin.site.register(Photo)
admin.site.register(Person)
admin.site.register(Face)
admin.site.register(AlbumAuto)
admin.site.register(AlbumUser)
