import importlib.util
import pathlib
import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch


class _FakeQuerySet(list):
    def count(self):
        return len(self)


class GeolocateLoggingTests(unittest.TestCase):
    def test_geolocate_logs_exception_without_crash(self):
        fake_logger = MagicMock()
        fake_api_module = ModuleType("api")
        fake_api_module.__path__ = []

        fake_models_module = ModuleType("api.models")
        fake_models_module.Photo = MagicMock()

        fake_photo_caption_module = ModuleType("api.models.photo_caption")
        fake_photo_caption_module.PhotoCaption = MagicMock()

        fake_util_module = ModuleType("api.util")
        fake_util_module.logger = fake_logger

        fake_django_module = ModuleType("django")
        fake_django_apps = ModuleType("django.apps")
        fake_django_apps.AppConfig = object
        fake_django_module.apps = fake_django_apps

        fake_django_db_module = ModuleType("django.db")
        fake_django_db_module.models = SimpleNamespace(Q=MagicMock())

        fake_tqdm_module = ModuleType("tqdm")
        fake_tqdm_module.tqdm = MagicMock()

        module_path = pathlib.Path(__file__).resolve().parents[1] / "background_tasks.py"

        exception_mock = None

        with patch.dict(
            sys.modules,
            {
                "api": fake_api_module,
                "api.models": fake_models_module,
                "api.models.photo_caption": fake_photo_caption_module,
                "api.util": fake_util_module,
                "django": fake_django_module,
                "django.apps": fake_django_apps,
                "django.db": fake_django_db_module,
                "tqdm": fake_tqdm_module,
            },
        ):
            spec = importlib.util.spec_from_file_location(
                "api.background_tasks", module_path
            )
            module = importlib.util.module_from_spec(spec)
            sys.modules["api.background_tasks"] = module
            spec.loader.exec_module(module)

            photo = MagicMock()
            photo._geolocate.side_effect = RuntimeError("boom")
            photo.main_file = SimpleNamespace(path="fake-path")

            photos = _FakeQuerySet([photo])

            fake_models_module.Photo.objects.filter.return_value = photos

            with patch("api.background_tasks.logger.exception") as mock_exception:
                module.geolocate()
                exception_mock = mock_exception
                logged_args = mock_exception.call_args[0]

        self.assertIsNotNone(exception_mock)
        exception_mock.assert_called_once()
        self.assertEqual(logged_args[0], "could not geolocate photo: %s")
        self.assertIs(logged_args[1], photo)

