"""Characterization tests for service/llm/main.py::load_model.

These pin the CURRENT observed behavior of the LLM microservice model loader
before refactoring. No real model is ever loaded: ``Llama``,
``MoondreamChatHandler`` and ``Path`` are patched, and the module-level
globals (``llm_model`` / ``current_model_path``) are saved and restored
around every test.
"""

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from service.llm import main as llm_main

TEXT_MODEL = "/protected_media/data_models/moondream2-text-model-f16.gguf"
MMPROJ = "/protected_media/data_models/moondream2-mmproj-f16.gguf"


class FakePath:
    """Stand-in for pathlib.Path with a scripted exists()."""

    def __init__(self, path, exists=True):
        self.path = path
        self._exists = exists

    def exists(self):
        return self._exists


class LoadModelCharacterizationTest(SimpleTestCase):
    def setUp(self):
        self._saved_model = llm_main.llm_model
        self._saved_path = llm_main.current_model_path
        llm_main.llm_model = None
        llm_main.current_model_path = None
        self.logs = []
        p = patch.object(llm_main, "log", self.logs.append)
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        llm_main.llm_model = self._saved_model
        llm_main.current_model_path = self._saved_path

    # ---- helpers -------------------------------------------------------

    def patch_llama(self, side_effect=None):
        llama = MagicMock(name="Llama")
        if side_effect is not None:
            llama.side_effect = side_effect
        p = patch.object(llm_main, "Llama", llama)
        p.start()
        self.addCleanup(p.stop)
        return llama

    def patch_path(self, exists=True):
        p = patch.object(llm_main, "Path", lambda path: FakePath(path, exists=exists))
        p.start()
        self.addCleanup(p.stop)

    def patch_handler(self, side_effect=None):
        handler_cls = MagicMock(name="MoondreamChatHandler")
        if side_effect is not None:
            handler_cls.side_effect = side_effect
        p = patch("llama_cpp.llama_chat_format.MoondreamChatHandler", handler_cls)
        p.start()
        self.addCleanup(p.stop)
        return handler_cls

    # ---- text-only happy path ------------------------------------------

    def test_text_model_loaded_with_verbose_false_only(self):
        llama = self.patch_llama()

        llm_main.load_model(TEXT_MODEL)

        llama.assert_called_once_with(model_path=TEXT_MODEL, verbose=False)
        self.assertIs(llm_main.llm_model, llama.return_value)
        self.assertEqual(llm_main.current_model_path, TEXT_MODEL)
        self.assertIn("Model loaded successfully", self.logs)
        self.assertIn(f"Loading model from {TEXT_MODEL}, multimodal: False", self.logs)

    def test_default_multimodal_argument_is_false(self):
        llama = self.patch_llama()
        # Explicit multimodal=False must behave identically to the default.
        llm_main.load_model("/models/a.gguf", multimodal=False)
        llama.assert_called_once_with(model_path="/models/a.gguf", verbose=False)

    def test_reload_skipped_when_same_path_already_loaded(self):
        llama = self.patch_llama()
        llm_main.load_model(TEXT_MODEL)
        first = llm_main.llm_model
        self.logs.clear()

        llm_main.load_model(TEXT_MODEL)

        self.assertEqual(llama.call_count, 1)
        self.assertIs(llm_main.llm_model, first)
        self.assertEqual(self.logs, [])

    def test_reload_skipped_regardless_of_multimodal_flag_change(self):
        """BUG (pinned): only the path is compared, so switching a loaded
        text model to multimodal=True is a silent no-op."""
        llama = self.patch_llama()
        self.patch_path(exists=True)
        handler_cls = self.patch_handler()

        llm_main.load_model(TEXT_MODEL, multimodal=False)
        llm_main.load_model(TEXT_MODEL, multimodal=True)

        self.assertEqual(llama.call_count, 1)
        self.assertEqual(handler_cls.call_count, 0)

    def test_switching_path_triggers_reload(self):
        llama = self.patch_llama()
        llm_main.load_model("/models/a.gguf")
        llm_main.load_model("/models/b.gguf")

        self.assertEqual(llama.call_count, 2)
        self.assertEqual(llm_main.current_model_path, "/models/b.gguf")

    def test_loads_when_path_matches_but_model_is_none(self):
        llama = self.patch_llama()
        llm_main.current_model_path = TEXT_MODEL
        llm_main.llm_model = None

        llm_main.load_model(TEXT_MODEL)

        self.assertEqual(llama.call_count, 1)

    # ---- multimodal happy path -----------------------------------------

    def test_multimodal_builds_chat_handler_and_passes_it_to_llama(self):
        llama = self.patch_llama()
        self.patch_path(exists=True)
        handler_cls = self.patch_handler()

        llm_main.load_model(TEXT_MODEL, multimodal=True)

        handler_cls.assert_called_once_with(clip_model_path=MMPROJ)
        llama.assert_called_once_with(
            model_path=TEXT_MODEL,
            chat_handler=handler_cls.return_value,
            n_ctx=2048,
            verbose=False,
        )
        self.assertEqual(llm_main.current_model_path, TEXT_MODEL)
        self.assertIn(
            f"Loading Moondream chat handler with mmproj: {MMPROJ}", self.logs
        )
        self.assertIn(f"Loading model from {TEXT_MODEL}, multimodal: True", self.logs)

    # ---- error branches -------------------------------------------------

    def test_missing_mmproj_raises_and_leaves_state_untouched(self):
        llama = self.patch_llama()
        self.patch_path(exists=False)
        handler_cls = self.patch_handler()

        with self.assertRaises(Exception) as ctx:
            llm_main.load_model(TEXT_MODEL, multimodal=True)

        self.assertEqual(
            str(ctx.exception), f"Moondream mmproj file not found at {MMPROJ}"
        )
        self.assertEqual(handler_cls.call_count, 0)
        self.assertEqual(llama.call_count, 0)
        self.assertIsNone(llm_main.llm_model)
        self.assertIsNone(llm_main.current_model_path)
        self.assertIn(
            f"Error loading model: Moondream mmproj file not found at {MMPROJ}",
            self.logs,
        )

    def test_llama_constructor_failure_propagates_and_is_logged(self):
        self.patch_llama(side_effect=RuntimeError("boom"))

        with self.assertRaises(RuntimeError) as ctx:
            llm_main.load_model(TEXT_MODEL)

        self.assertEqual(str(ctx.exception), "boom")
        self.assertIsNone(llm_main.llm_model)
        self.assertIsNone(llm_main.current_model_path)
        self.assertIn("Error loading model: boom", self.logs)
        self.assertNotIn("Model loaded successfully", self.logs)

    def test_failed_reload_keeps_previous_model_and_path(self):
        """BUG (pinned): a failed reload leaves the OLD model live under the
        OLD path, so the caller keeps generating with the wrong model."""
        llama = self.patch_llama()
        llm_main.load_model("/models/a.gguf")
        old_model = llm_main.llm_model
        llama.side_effect = RuntimeError("nope")

        with self.assertRaises(RuntimeError):
            llm_main.load_model("/models/b.gguf")

        self.assertIs(llm_main.llm_model, old_model)
        self.assertEqual(llm_main.current_model_path, "/models/a.gguf")

    def test_chat_handler_failure_propagates(self):
        llama = self.patch_llama()
        self.patch_path(exists=True)
        self.patch_handler(side_effect=ValueError("bad clip"))

        with self.assertRaises(ValueError):
            llm_main.load_model(TEXT_MODEL, multimodal=True)

        self.assertEqual(llama.call_count, 0)
        self.assertIn("Error loading model: bad clip", self.logs)

    def test_none_model_path_still_attempts_load(self):
        """None is not special-cased: with both globals None the guard's
        first clause is True, so Llama is invoked with model_path=None."""
        llama = self.patch_llama()

        llm_main.load_model(None)

        llama.assert_called_once_with(model_path=None, verbose=False)
        self.assertIsNone(llm_main.current_model_path)


class LogHelperTest(SimpleTestCase):
    def test_log_prefixes_message(self):
        with patch("builtins.print") as mock_print:
            llm_main.log("hello")
        mock_print.assert_called_once_with("llm: hello")
