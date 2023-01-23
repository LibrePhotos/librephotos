from django.test import TestCase

from api.api_util import get_search_term_examples
from api.models import User


class GetSearchTermExamples(TestCase):
    def test_get_search_term_examples(self):
        admin = User.objects.create_superuser(
            "test_admin", "test_admin@test.com", "test_password"
        )
        array = get_search_term_examples(admin)
        self.assertEqual(len(array), 5)
