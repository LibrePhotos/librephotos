from django.contrib import admin
from .models import ChunkedUpload


class ChunkedUploadAdmin(admin.ModelAdmin):
    list_display = ('upload_id', 'filename', 'status', 'created_on')
    search_fields = ('filename', 'filename')
    list_filter = ('status',)


admin.site.register(ChunkedUpload, ChunkedUploadAdmin)
