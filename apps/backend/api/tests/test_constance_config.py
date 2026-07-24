from django.conf import settings
from django.test import TestCase
from django.urls import reverse

from api.tests.utils import create_test_user


class ConstanceAdminTest(TestCase):
    """The constance admin has to render for every key in CONSTANCE_CONFIG.

    ConstanceForm walks the whole config on __init__, so a single malformed
    entry takes the entire page down rather than just its own row.
    """

    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.client.force_login(self.admin)

    def test_constance_changelist_renders(self):
        response = self.client.get(reverse("admin:constance_config_changelist"))
        self.assertEqual(response.status_code, 200)


class ConstanceAdditionalFieldsTest(TestCase):
    """Guard the class of bug, not just the one instance of it.

    A CONSTANCE_CONFIG entry may declare its type either as a Python type or as
    the name of a CONSTANCE_ADDITIONAL_FIELDS entry. constance tells the two
    apart with ``config_type not in settings.ADDITIONAL_FIELDS and not
    isinstance(default, config_type)`` -- so a name with no matching additional
    field falls through to ``isinstance(default, "some_string")``, which raises
    TypeError and 500s the admin on every install.
    """

    def test_every_named_field_type_is_defined(self):
        named_types = {
            name: options[2]
            for name, options in settings.CONSTANCE_CONFIG.items()
            if len(options) == 3 and isinstance(options[2], str)
        }
        undefined = {
            name: field_type
            for name, field_type in named_types.items()
            if field_type not in settings.CONSTANCE_ADDITIONAL_FIELDS
        }
        self.assertEqual(
            undefined,
            {},
            "CONSTANCE_CONFIG entries name a custom field type that is missing "
            "from CONSTANCE_ADDITIONAL_FIELDS; the constance admin raises "
            "TypeError on these",
        )

    def test_defaults_are_valid_choices_for_named_field_types(self):
        """A default outside its own choice list makes the admin form invalid."""
        for name, options in settings.CONSTANCE_CONFIG.items():
            if len(options) != 3 or not isinstance(options[2], str):
                continue
            field = settings.CONSTANCE_ADDITIONAL_FIELDS.get(options[2])
            if not field or len(field) < 2:
                continue
            choices = field[1].get("choices")
            if not choices:
                continue
            with self.subTest(key=name):
                values = [value for value, _label in choices]
                self.assertIn(str(options[0]).lower(), [v.lower() for v in values])
