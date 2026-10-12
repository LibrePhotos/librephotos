"""``api/tests/stubs.py`` puts sys.modules back exactly as it found it.

A stub that outlives its test shadows the real module for every later test in
the process, so the restore path is pinned directly, including when the block
raises.
"""

import sys
import types

from django.test import SimpleTestCase

from api.tests.stubs import (
    BACKEND_ROOT,
    load_backend_file,
    stub_modules,
    unique_module_name,
)


class StubModulesTest(SimpleTestCase):
    def test_an_absent_name_is_removed_afterwards(self):
        name = unique_module_name("stub_absent")
        self.assertNotIn(name, sys.modules)

        with stub_modules({name: types.ModuleType(name)}):
            self.assertIn(name, sys.modules)

        self.assertNotIn(name, sys.modules)

    def test_a_present_name_gets_its_original_module_back(self):
        name = unique_module_name("stub_present")
        original = types.ModuleType(name)

        with stub_modules({name: original}):
            with stub_modules({name: types.ModuleType(name)}):
                self.assertIsNot(sys.modules[name], original)

            self.assertIs(sys.modules[name], original)

        self.assertNotIn(name, sys.modules)

    def test_everything_is_restored_when_the_block_raises(self):
        name = unique_module_name("stub_raises")

        with self.assertRaises(RuntimeError):
            with stub_modules({name: types.ModuleType(name)}):
                raise RuntimeError("the test body failed")

        self.assertNotIn(name, sys.modules)

    def test_names_the_block_did_not_touch_are_left_alone(self):
        before = set(sys.modules)
        name = unique_module_name("stub_untouched")

        with stub_modules({name: types.ModuleType(name)}):
            pass

        self.assertEqual(set(sys.modules) - before, set())


class LoadBackendFileTest(SimpleTestCase):
    def test_the_file_is_resolved_from_the_backend_root(self):
        name = unique_module_name("stubs_probe")

        module = load_backend_file("api/tests/stubs.py", name=name)

        self.assertEqual(module.BACKEND_ROOT, BACKEND_ROOT)
        self.assertTrue(callable(module.stub_modules))

    def test_the_loaded_module_is_not_left_registered(self):
        name = unique_module_name("stubs_probe")

        module = load_backend_file("api/tests/stubs.py", name=name)

        self.assertNotIn(name, sys.modules)
        self.assertIsNot(module, sys.modules.get("api.tests.stubs"))
