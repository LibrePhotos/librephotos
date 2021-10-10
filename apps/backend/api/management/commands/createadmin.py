import os
import sys

from django.core.management.base import BaseCommand, CommandError
from django.core.validators import ValidationError, validate_email

from api.models import User


class Command(BaseCommand):
    help = "Create a LibrePhotos user with administrative permissions"

    def add_arguments(self, parser):
        parser.add_argument("admin_username", help="Username to create")
        parser.add_argument("admin_email", help="Email address of the new user")
        parser.add_argument(
            "-u",
            "--update",
            help=(
                "Update an existing superuser's password (ignoring the"
                "provided email) instead of reporting an error"
            ),
            action="store_true",
        )
        # Done this way because command lines are visible to the whole system by
        #  default on Linux, so a password in the arguments would leak
        parser.epilog = (
            "The password is read from the ADMIN_PASSWORD"
            "environment variable or interactively if"
            "ADMIN_PASSWORD is not set"
        )

    def handle(self, *args, **options):
        try:
            validate_email(options["admin_email"])
        except ValidationError as err:
            raise CommandError(err.message)

        if "ADMIN_PASSWORD" in os.environ:
            options["admin_password"] = os.environ["ADMIN_PASSWORD"]
        else:
            options["admin_password"] = User.objects.make_random_password()

        if not options["admin_password"]:
            raise CommandError("Admin password cannot be empty")

        if not User.objects.filter(username=options["admin_username"].lower()).exists():
            User.objects.create_superuser(
                options["admin_username"].lower(),
                options["admin_email"],
                options["admin_password"],
            )
        elif options["update"]:
            print(
                "Warning: ignoring provided email " + options["admin_email"],
                file=sys.stderr,
            )
            admin_user = User.objects.get(username=options["admin_username"].lower())
            admin_user.set_password(options["admin_password"])
            admin_user.save()
        else:
            raise CommandError("Specified user already exists")
