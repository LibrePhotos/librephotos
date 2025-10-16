import importlib.machinery
import importlib.util
import sys
import types
import unittest
from unittest.mock import patch


def _ensure_stub_modules():
    if "django" not in sys.modules:
        django_module = types.ModuleType("django")
        django_db_module = types.ModuleType("django.db")
        django_db_models_module = types.ModuleType("django.db.models")

        class DummyModel:
            pass

        def dummy_field(*args, **kwargs):
            return None

        django_db_models_module.Model = DummyModel
        django_db_models_module.CharField = dummy_field
        django_db_models_module.TextField = dummy_field
        django_db_models_module.PositiveIntegerField = dummy_field
        django_db_models_module.BooleanField = dummy_field
        django_db_models_module.ManyToManyField = dummy_field

        django_module.db = django_db_module
        django_db_module.models = django_db_models_module
        django_module.__path__ = []
        django_db_module.__path__ = []
        django_module.__spec__ = importlib.machinery.ModuleSpec(
            "django", loader=None, is_package=True
        )
        django_db_module.__spec__ = importlib.machinery.ModuleSpec(
            "django.db", loader=None, is_package=True
        )
        django_db_models_module.__spec__ = importlib.machinery.ModuleSpec(
            "django.db.models", loader=None
        )

        sys.modules["django"] = django_module
        sys.modules["django.db"] = django_db_module
        sys.modules["django.db.models"] = django_db_models_module

    if "magic" not in sys.modules:
        magic_module = types.ModuleType("magic")

        class Magic:
            def __init__(self, *args, **kwargs):
                pass

            def from_file(self, path):
                return "application/octet-stream"

        magic_module.Magic = Magic
        magic_module.__spec__ = importlib.machinery.ModuleSpec("magic", loader=None)
        sys.modules["magic"] = magic_module

    if "pyvips" not in sys.modules:
        pyvips_module = types.ModuleType("pyvips")

        class Image:
            @staticmethod
            def thumbnail(*args, **kwargs):
                raise NotImplementedError

        class Enums:
            class Size:
                DOWN = "down"

        pyvips_module.Image = Image
        pyvips_module.enums = Enums
        pyvips_module.__spec__ = importlib.machinery.ModuleSpec(
            "pyvips", loader=None
        )
        sys.modules["pyvips"] = pyvips_module

    if "api" not in sys.modules:
        api_module = types.ModuleType("api")
        api_module.__path__ = []
        api_module.__spec__ = importlib.machinery.ModuleSpec(
            "api", loader=None, is_package=True
        )

        util_module = types.ModuleType("api.util")

        class Logger:
            def error(self, *args, **kwargs):
                pass

        util_module.logger = Logger()
        util_module.__spec__ = importlib.machinery.ModuleSpec("api.util", loader=None)
        util_module.__file__ = "<stub>"

        models_module = types.ModuleType("api.models")
        models_module.__path__ = []
        models_module.__spec__ = importlib.machinery.ModuleSpec(
            "api.models", loader=None, is_package=True
        )

        api_module.util = util_module
        api_module.models = models_module

        sys.modules["api"] = api_module
        sys.modules["api.util"] = util_module
        sys.modules["api.models"] = models_module

    if "exiftool" not in sys.modules:
        exiftool_module = types.ModuleType("exiftool")
        exiftool_module.__spec__ = importlib.machinery.ModuleSpec(
            "exiftool", loader=None
        )
        sys.modules["exiftool"] = exiftool_module

    if "requests" not in sys.modules:
        requests_module = types.ModuleType("requests")
        requests_module.__spec__ = importlib.machinery.ModuleSpec(
            "requests", loader=None
        )
        sys.modules["requests"] = requests_module

    if "django.conf" not in sys.modules:
        django_conf_module = types.ModuleType("django.conf")
        django_conf_module.settings = types.SimpleNamespace(LOGS_ROOT="/tmp")
        django_conf_module.__spec__ = importlib.machinery.ModuleSpec(
            "django.conf", loader=None, is_package=True
        )
        sys.modules["django.conf"] = django_conf_module


def _load_file_module():
    _ensure_stub_modules()
    spec = importlib.util.spec_from_file_location(
        "api.models.file", "api/models/file.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["api.models.file"] = module
    spec.loader.exec_module(module)
    return module


_file_module = _load_file_module()


class TestIsVideo(unittest.TestCase):
    def test_is_video_returns_false_when_magic_raises(self):
        class FailingMagic:
            def from_file(self, path):
                raise RuntimeError("magic failure")

        with patch.object(
            _file_module.magic, "Magic", return_value=FailingMagic()
        ):
            self.assertFalse(_file_module.is_video("/tmp/test.mp4"))
