from django.core.management.base import BaseCommand
from api.models import User
from api.directory_watcher import scan_photos
from api.util import logger
import uuid
import django_rq

class Command(BaseCommand):
    help = 'scan directory for all users'
    def handle(self, *args, **kwargs):
        for user in User.objects.all():
            scan_photos(user,uuid.uuid4())
