"""The models and the committed migrations must agree.

Nothing else in the suite notices a model change that has no migration: the
test database is built from the migrations, and queries only fail once a
column is missing outright. Such a change (an index, a constraint, an option
in Meta) then waits for the next contributor's ``makemigrations``, which picks
it up along with their own change, or never reaches production at all. This
runs the same check as ``makemigrations --check``.

TestCase rather than SimpleTestCase: makemigrations reads the applied-migration
history from the database to check it is consistent.
"""

import io

from django.core.management import call_command
from django.test import TestCase


class MigrationsInSyncTest(TestCase):
    def test_models_match_committed_migrations(self) -> None:
        out = io.StringIO()
        try:
            call_command(
                "makemigrations",
                check=True,
                dry_run=True,
                verbosity=1,
                stdout=out,
            )
        except SystemExit:
            # --check exits non-zero and has already printed the pending
            # operations, which name the app and the model.
            self.fail(
                "Models have changes without a migration. Run "
                "`python manage.py makemigrations`, review the new file and "
                "commit it with the model change.\n\n" + out.getvalue()
            )
        self.assertIn("No changes detected", out.getvalue())
