import traceback
import uuid

from django.core.management.base import BaseCommand

from api.directory_watcher import scan_photos
from api.models import User
from api.models.user import get_deleted_user
from nextcloud.directory_watcher import scan_photos as scan_photos_nextcloud


class Command(BaseCommand):
    help = "scan directory for all users"

    def add_arguments(self, parser):
        parser_group = parser.add_mutually_exclusive_group()
        parser_group.add_argument(
            "-f", "--full-scan", help=("Run full directory scan"), action="store_true"
        )
        parser_group.add_argument(
            "-s", "--scan-files", help=("Scan a list of files"), nargs="+", default=[]
        )
        parser_group.add_argument(
            "-n",
            "--nextcloud",
            help=("Run nextcloud scan instead of directory scan"),
            action="store_true",
        )

    def handle(self, *args, **options):
        if options["nextcloud"]:
            self.nextcloud_scan()
        elif options["scan_files"]:
            self.scan_selected_files(options["scan_files"])
        else:
            self.directory_scan(options["full_scan"])

    def scannable_users(self):
        deleted_user: User = get_deleted_user()
        return [user for user in User.objects.all() if user != deleted_user]

    def scan_selected_files(self, scan_files):
        for user in self.scannable_users():
            user_files = [
                scan_file
                for scan_file in scan_files
                if scan_file.startswith(user.scan_directory)
            ]
            if user_files:
                scan_photos(user, False, uuid.uuid4(), scan_files=user_files)

    def directory_scan(self, full_scan):
        for user in self.scannable_users():
            scan_photos(user, full_scan, uuid.uuid4(), user.scan_directory)

    def nextcloud_scan(self):
        for user in User.objects.all():
            if not user.nextcloud_scan_directory:
                print(
                    f"Skipping nextcloud scan for user {user.username}. No scan directory configured."
                )
                continue
            print(f"Starting nextcloud scan for user {user.username}.")
            try:
                scan_photos_nextcloud(user, uuid.uuid4())
            except Exception:
                print(f"Nextcloud scan for user {user.username} failed:")
                print(traceback.format_exc())
