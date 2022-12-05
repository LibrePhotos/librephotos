import os
import sys

from django.core.management.base import BaseCommand, CommandError
from django.core.validators import ValidationError, validate_email

from api.models import User


class Command(BaseCommand):
    help = "Create a LibrePhotos user"

    def add_arguments(self, parser):
        parser.add_argument("username", help="Username to create")
        parser.add_argument("email", help="Email address of the new user")
        parser.add_argument(
            "--password",
            help="Password to create/update for user. (autogenerate if omitted)",
        )
        parser.add_argument(
            "--update",
            help=(
                "Update an existing user's password (ignoring the provided email) "
                "instead of reporting an error"
            ),
            action="store_true",
        )
        parser.add_argument(
            "--admin",
            help="Create user with administrative privileges",
            action="store_true",
        )
        # Done this way because command lines are visible to the whole system by
        #  default on Linux, so a password in the arguments would leak
        parser.epilog = (
            "When creating user with administrative privileges,"
            "the password is read from the ADMIN_PASSWORD"
            "environment variable or interactively if"
            "ADMIN_PASSWORD is not set"
        )

    def handle(self, *args, **options):
        try:
            validate_email(options["email"])
        except ValidationError as err:
            raise CommandError(err.message)

        if options["admin"] and "ADMIN_PASSWORD" in os.environ:
            options["password"] = os.environ["ADMIN_PASSWORD"]

        if not options["password"]:
            options["password"] = User.objects.make_random_password()

        if not User.objects.filter(username=options["username"].lower()).exists():
            if options["admin"]:
                User.objects.create_superuser(
                    options["username"].lower(),
                    options["email"],
                    options["password"],
                )
            else:
                User.objects.create_user(
                    options["username"].lower(),
                    options["email"],
                    options["password"],
                )

        elif options["update"]:
            print(
                "Warning: ignoring provided email " + options["email"],
                file=sys.stderr,
            )
            user = User.objects.get(username=options["username"].lower())
            user.set_password(options["password"])
            user.save()
        else:
            raise CommandError("Specified user already exists")
