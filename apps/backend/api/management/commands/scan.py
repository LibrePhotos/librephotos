import uuid

import django_rq
from django.core.management.base import BaseCommand

from api.directory_watcher import scan_photos
from api.models import User
from api.util import logger


class Command(BaseCommand):
    help = 'scan directory for all users'

    def add_arguments(self, parser):
        parser.add_argument('-f', '--full-scan',
            help=('Run full scan'),
            action='store_true'
        )

    def handle(self, *args, **options):
        for user in User.objects.all():
            scan_photos(user, options['full_scan'], uuid.uuid4())
