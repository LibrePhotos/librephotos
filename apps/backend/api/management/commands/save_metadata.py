from django.core.management.base import BaseCommand

from api.models import Photo


class Command(BaseCommand):
    help = "save metadata to image files (or XMP sidecar files)"

    def handle(self, *args, **kwargs):
        for photo in Photo.objects.all():
            photo._save_metadata()
