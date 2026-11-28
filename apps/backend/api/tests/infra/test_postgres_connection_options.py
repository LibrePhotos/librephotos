from django.test import SimpleTestCase

from librephotos.settings import production


class PostgresConnectionOptionsTest(SimpleTestCase):
    def test_the_backend_turns_off_the_jit_compiler_for_its_connections(self):
        options = production.DATABASES["default"]["OPTIONS"]["options"]

        self.assertIn("-c jit=off", options)
