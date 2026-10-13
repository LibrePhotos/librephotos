import importlib

from django.apps import apps as global_apps
from django.db import connection
from django.test import TestCase

from api.models import User
from api.tests.utils import create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0172 = importlib.import_module(
    "api.migrations.0172_cluster_selection_epsilon_unit_scale"
)


class ClusterSelectionEpsilonUnitScaleTest(TestCase):
    """#1996: a saved epsilon keeps its label on the unit-length scale."""

    def _user(self, epsilon: float) -> User:
        user = create_test_user()
        User.objects.filter(pk=user.pk).update(cluster_selection_epsilon=epsilon)
        return user

    def _epsilon(self, user: User) -> float:
        return User.objects.get(pk=user.pk).cluster_selection_epsilon

    def _forwards(self) -> None:
        # The editor is not used: no context, no DDL.
        migration_0172.forwards(global_apps, connection.schema_editor())

    def _backwards(self) -> None:
        migration_0172.backwards(global_apps, connection.schema_editor())

    def test_each_old_choice_becomes_the_new_choice_of_the_same_label(self) -> None:
        cases = {0.0: 0.0, 0.025: 0.9, 0.05: 0.95, 0.1: 1.0, 0.2: 1.05}
        users = {old: self._user(old) for old in cases}

        self._forwards()

        for old, new in cases.items():
            with self.subTest(old=old):
                self.assertEqual(self._epsilon(users[old]), new)

    def test_another_old_scale_value_gets_the_nearest_choice(self) -> None:
        user = self._user(0.11)

        self._forwards()

        self.assertEqual(self._epsilon(user), 1.0)

    def test_an_unscaled_arcface_distance_becomes_very_high(self) -> None:
        user = self._user(18.0)

        self._forwards()

        self.assertEqual(self._epsilon(user), 1.05)

    def test_a_value_on_the_unit_scale_is_kept(self) -> None:
        user = self._user(0.7)

        self._forwards()

        self.assertEqual(self._epsilon(user), 0.7)

    def test_backwards_restores_the_old_choices(self) -> None:
        users = {old: self._user(old) for old in (0.0, 0.025, 0.05, 0.1, 0.2)}

        self._forwards()
        self._backwards()

        for old, user in users.items():
            with self.subTest(old=old):
                self.assertEqual(self._epsilon(user), old)
