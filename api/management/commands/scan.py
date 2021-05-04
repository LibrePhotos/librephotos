from django.core.management.base import BaseCommand
from api.models import User
from api.directory_watcher import scan_photos
from nextcloud.directory_watcher import scan_photos as scan_photos_cloud
from api.util import logger
import uuid
import django_rq

class Command(BaseCommand):
    help = 'scan directory for all users'
    def handle(self, *args, **kwargs):
        for user in User.objects.all():
            print("scan user : " + user.username)
            if user.scan_directory != None and user.scan_directory != "" :
                print("Scan folder : " + user.scan_directory)
                scan_photos(user,uuid.uuid4())
            if user.nextcloud_server_address != None and user.nextcloud_server_address != "":
                print("Scan cloud url : " + user.scan_directory)
                scan_photos_cloud(user,uuid.uuid4())
