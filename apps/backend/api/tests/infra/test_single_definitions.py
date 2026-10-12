"""Helpers that once had several diverging copies are defined once.

Five hand-written extension sets drifted apart (``.hif``, ``.avif`` and
``.jxl`` were images to the scanner but not to the RAW pairing), six sidecars
rebuilt ``BASE_DATA/protected_media`` themselves and ``is_hidden`` existed
twice with different error handling (#2339). This module keeps each of them in
one place:

* media extensions are spelled out only in ``api/mime.py``; the few other
  literals name files LibrePhotos writes itself (thumbnails, face crops) and
  are listed in ``EXTENSION_LITERALS_ALLOWED``;
* every named subset in ``api/mime.py`` stays inside its full set;
* ``"protected_media"`` and ``"data_models"`` are spelled only by the path
  helpers in ``librephotos/env.py`` (the ``/protected_media/`` URL prefix in
  ``api/views/media.py`` is a different string);
* the functions in ``DEFINED_ONCE`` have a single definition.

Like ``test_sidecar_urls``, it reads the backend's own source, without tests,
migrations and ``scripts/``.
"""

import ast
import os
from collections import Counter
from collections.abc import Iterable, Iterator

from django.test import SimpleTestCase

from api import mime

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
SOURCE_DIRS = ("api", "librephotos", "service", "image_similarity", "nextcloud")
SKIPPED_DIRS = ("tests", "test", "migrations", "__pycache__")

MEDIA_EXTENSIONS = (
    mime.IMAGE_EXTENSIONS
    | mime.VIDEO_EXTENSIONS
    | mime.RAW_EXTENSIONS
    | mime.METADATA_EXTENSIONS
)
MIME_MODULE = "api/mime.py"
# Extensions of files LibrePhotos writes itself, which are not a question of
# "what kind of file is this": the thumbnails and video previews it renders,
# the face crops it saves and the transcodes it caches. Screenshot detection
# looks for one format by name.
EXTENSION_LITERALS_ALLOWED = {
    "api/models/thumbnail.py": {".webp", ".mp4"},
    "api/faces/photo_faces.py": {".jpg"},
    "api/classification/screenshots.py": {".png"},
    "api/thumbnails/metadata.py": {".webp", ".mp4"},
    "api/thumbnails/render.py": {".webp", ".mp4"},
    "api/video/transcode_cache.py": {".mp4"},
    "api/views/faces.py": {".jpg"},
    "api/views/media.py": {".webp", ".mp4"},
}

PATH_HELPER_MODULE = "librephotos/env.py"
DATA_DIRECTORY_NAMES = {"protected_media", "data_models"}

DEFINED_ONCE = {
    "is_hidden",
    "rules_json",
    "_as_json",
    "protected_media_root",
    "data_models_root",
}


def _sources() -> Iterator[tuple[str, str]]:
    """(path relative to the backend in POSIX form, source) of every module."""
    for top in SOURCE_DIRS:
        for root, dirs, files in os.walk(os.path.join(BACKEND, top)):
            dirs[:] = [d for d in dirs if d not in SKIPPED_DIRS]
            for name in files:
                if name.endswith(".py"):
                    path = os.path.join(root, name)
                    with open(path, encoding="utf-8") as handle:
                        source = handle.read()
                    yield os.path.relpath(path, BACKEND).replace(os.sep, "/"), source


def _string_constants(source: str) -> Iterator[tuple[int, str]]:
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.lineno, node.value


def extension_literal_offenders(sources: Iterable[tuple[str, str]]) -> list[str]:
    """``path:line 'literal'`` for each media extension written outside api.mime."""
    offenders = []
    for path, source in sources:
        if path == MIME_MODULE:
            continue
        allowed = EXTENSION_LITERALS_ALLOWED.get(path, set())
        for line, value in _string_constants(source):
            if value.lower() in MEDIA_EXTENSIONS and value not in allowed:
                offenders.append(f"{path}:{line} {value!r}")
    return offenders


def data_directory_offenders(sources: Iterable[tuple[str, str]]) -> list[str]:
    """``path:line 'name'`` for each data directory name outside the path helpers."""
    offenders = []
    for path, source in sources:
        if path == PATH_HELPER_MODULE:
            continue
        for line, value in _string_constants(source):
            if value in DATA_DIRECTORY_NAMES:
                offenders.append(f"{path}:{line} {value!r}")
    return offenders


def repeated_definitions(sources: Iterable[tuple[str, str]]) -> dict[str, int]:
    """The names in DEFINED_ONCE defined more than once, with their count."""
    counts: Counter[str] = Counter()
    for _, source in sources:
        for node in ast.walk(ast.parse(source)):
            if (
                isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
                and node.name in DEFINED_ONCE
            ):
                counts[node.name] += 1
    return {name: count for name, count in counts.items() if count > 1}


class SingleDefinitionsTest(SimpleTestCase):
    def test_media_extensions_are_spelled_only_in_api_mime(self) -> None:
        self.assertEqual(
            extension_literal_offenders(_sources()),
            [],
            "import the extension sets from api.mime",
        )

    def test_data_directories_are_named_only_by_the_path_helpers(self) -> None:
        self.assertEqual(
            data_directory_offenders(_sources()),
            [],
            "use librephotos.env.protected_media_root / data_models_root",
        )

    def test_helpers_are_defined_once(self) -> None:
        self.assertEqual(repeated_definitions(_sources()), {})

    def test_every_helper_still_exists(self) -> None:
        # A rename would otherwise leave the check above guarding nothing.
        counts: Counter[str] = Counter()
        for _, source in _sources():
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, ast.FunctionDef):
                    counts[node.name] += 1
        self.assertEqual(
            {name for name in DEFINED_ONCE if counts[name] == 1},
            DEFINED_ONCE - {"_as_json"},
        )

    def test_the_allow_list_is_not_stale(self) -> None:
        sources = dict(_sources())
        for path, allowed in EXTENSION_LITERALS_ALLOWED.items():
            with self.subTest(path=path):
                values = {value for _, value in _string_constants(sources[path])}
                self.assertEqual(allowed - values, set())


class ExtensionSetsTest(SimpleTestCase):
    def test_sets_are_lower_case_with_a_dot(self) -> None:
        for extension in MEDIA_EXTENSIONS:
            with self.subTest(extension=extension):
                self.assertEqual(extension, extension.lower())
                self.assertTrue(extension.startswith("."))

    def test_full_sets_do_not_overlap(self) -> None:
        sets = [
            mime.IMAGE_EXTENSIONS,
            mime.VIDEO_EXTENSIONS,
            mime.RAW_EXTENSIONS,
            mime.METADATA_EXTENSIONS,
        ]
        self.assertEqual(sum(len(s) for s in sets), len(MEDIA_EXTENSIONS))

    def test_named_subsets_stay_inside_their_full_set(self) -> None:
        self.assertLessEqual(mime.RAW_PAIR_EXTENSIONS, mime.IMAGE_EXTENSIONS)
        self.assertLessEqual(mime.CV2_DECODABLE_EXTENSIONS, mime.IMAGE_EXTENSIONS)
        self.assertLessEqual(mime.EXIF_ORIENTED_EXTENSIONS, mime.IMAGE_EXTENSIONS)
        self.assertLessEqual(mime.LIVE_PHOTO_VIDEO_EXTENSIONS, mime.VIDEO_EXTENSIONS)

    def test_raw_pairing_covers_the_modern_camera_formats(self) -> None:
        # The formats #2339 found missing from the pairing set.
        self.assertLessEqual(
            {".hif", ".avif", ".jxl", ".webp"}, mime.RAW_PAIR_EXTENSIONS
        )


class PlantedDuplicatesAreCaughtTest(SimpleTestCase):
    """The checks fail on the copies they exist to stop."""

    def test_an_extension_set_in_a_view(self) -> None:
        planted = [("api/views/planted.py", 'IMAGES = {".jpg", ".png"}\n')]
        self.assertEqual(
            extension_literal_offenders(planted),
            ["api/views/planted.py:1 '.jpg'", "api/views/planted.py:1 '.png'"],
        )

    def test_an_upper_case_extension(self) -> None:
        planted = [("api/planted.py", 'if ext in [".CR2", ".NEF"]: pass\n')]
        self.assertEqual(len(extension_literal_offenders(planted)), 2)

    def test_an_allowed_file_may_not_add_other_extensions(self) -> None:
        planted = [("api/faces/photo_faces.py", 'name = f"{hash}.jpg"\nOK = ".png"\n')]
        self.assertEqual(
            extension_literal_offenders(planted), ["api/faces/photo_faces.py:2 '.png'"]
        )

    def test_a_protected_media_path_in_a_sidecar(self) -> None:
        planted = [
            (
                "service/planted/main.py",
                "import os\n"
                "ROOT = os.path.join(\n"
                '    os.environ["BASE_DATA"], "protected_media", "data_models"\n'
                ")\n",
            )
        ]
        self.assertEqual(
            data_directory_offenders(planted),
            [
                "service/planted/main.py:3 'protected_media'",
                "service/planted/main.py:3 'data_models'",
            ],
        )

    def test_the_url_prefix_is_a_different_string(self) -> None:
        planted = [("api/views/planted.py", 'URL = f"/protected_media/{path}"\n')]
        self.assertEqual(data_directory_offenders(planted), [])

    def test_a_second_is_hidden(self) -> None:
        planted = [
            ("api/directory_watcher/utils.py", "def is_hidden(path): ...\n"),
            ("api/api_util.py", "def is_hidden(filepath): ...\n"),
        ]
        self.assertEqual(repeated_definitions(planted), {"is_hidden": 2})
