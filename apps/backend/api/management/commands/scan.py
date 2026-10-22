import traceback
import uuid
from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from api.directory_watcher import scan_photos
from api.models import User
from api.models.user import get_deleted_user
from api.photos.paths import library_of
from nextcloud.directory_watcher import scan_photos as scan_photos_nextcloud


class Command(BaseCommand):
    help = "scan directory for all users"

    def add_arguments(self, parser: CommandParser) -> None:
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

    def handle(self, *args: Any, **options: Any) -> None:
        if options["nextcloud"]:
            self.nextcloud_scan()
        elif options["scan_files"]:
            self.scan_selected_files(options["scan_files"])
        else:
            self.directory_scan(options["full_scan"])

    def scannable_users(self) -> list[User]:
        # A user without a scan directory (e.g. one who only views shared
        # albums) has nothing to scan; walking "" raised and stopped the scan
        # for every user after them.
        deleted_user: User = get_deleted_user()
        return [
            user
            for user in User.objects.all()
            if user != deleted_user and user.scan_directory
        ]

    def scan_selected_files(self, scan_files: list[str]) -> None:
        for user in self.scannable_users():
            # A path boundary, not a string prefix: /data/alice2/x.jpg is not
            # alice's file just because it starts with /data/alice. Any of
            # the user's library folders counts (#123).
            library = library_of(user)
            user_files = [
                scan_file for scan_file in scan_files if library.contains(scan_file)
            ]
            if user_files:
                scan_photos(user, False, uuid.uuid4(), scan_files=user_files)

    def directory_scan(self, full_scan: bool) -> None:
        for user in self.scannable_users():
            scan_photos(user, full_scan, uuid.uuid4(), user.scan_directory)

    def nextcloud_scan(self) -> None:
        for user in User.objects.all():
            if not user.nextcloud_scan_directory:
                self.stdout.write(
                    f"Skipping nextcloud scan for user {user.username}. No scan directory configured."
                )
                continue
            self.stdout.write(f"Starting nextcloud scan for user {user.username}.")
            try:
                scan_photos_nextcloud(user, uuid.uuid4())
            except Exception:
                self.stderr.write(f"Nextcloud scan for user {user.username} failed:")
                self.stderr.write(traceback.format_exc())
