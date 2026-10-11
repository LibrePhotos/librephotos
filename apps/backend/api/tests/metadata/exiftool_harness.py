"""Real ExifTool for the metadata write-back tests (#2288).

Most of the suite patches ``write_metadata`` away, so a tag name ExifTool does
not know, a tag that cannot live in an ``.xmp`` or a wrong orientation all
pass. ``RealExifToolTestCase`` runs the write paths against real files and
reads the result back through the code the scan uses:

* Writes: ``api.metadata.writer`` gets one long-lived ExifTool process
  (``RecordingExifTool``) instead of starting one per call. It runs with the
  writer's own common arguments (``-G -n``) and records every write, checking
  that ExifTool reported the file updated and that every tag it was given is
  in the target afterwards (``WriteRecord.problems``).
* Reads: the HTTP call inside ``get_metadata`` is answered by the exif
  service's own Flask route, in process, with its two ExifTool instances
  replaced by the shared ones. Patching the transport rather than
  ``get_metadata`` covers the modules that imported it by name
  (``face_regions``, ``face_extractor``, ``photo_datetime``, ...), and reads
  go through the real service code without a server.
* Fixtures are generated at test time: JPEG, PNG and TIFF with Pillow, HEIC
  with pillow-heif, MP4 with the ffmpeg-bin wheel's ffmpeg. A format whose
  encoder is missing on the platform skips the test that needs it.

One ExifTool process pair per test class keeps this fast.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace, TracebackType
from typing import TYPE_CHECKING
from unittest.mock import patch

import exiftool
import PIL.Image
import requests
from django.test import TestCase, override_settings

from api import sidecars
from api.metadata.reader import get_sidecar_files_in_priority_order
from api.models.file import File
from api.models.photo import Photo
from api.models.user import User
from api.tests.utils import create_test_photo

if TYPE_CHECKING:
    import pyvips

EXIFTOOL = shutil.which("exiftool")
FFMPEG = shutil.which("ffmpeg")

# Stored image: four coloured quadrants, wider than tall, so every one of the
# eight EXIF orientations (and so every rotation and flip) looks different.
WIDTH, HEIGHT = 96, 64
QUADRANTS = {
    "red": (230, 20, 20),
    "green": (20, 200, 20),
    "blue": (20, 20, 230),
    "white": (240, 240, 240),
}
# Stored layout, read left to right, top to bottom.
STORED_LAYOUT = ("red", "green", "blue", "white")

# What ExifTool prints on stdout for a write that reached the file.
WRITE_LANDED = (b"1 image files updated", b"1 image files created")


@dataclass
class WriteRecord:
    """One write ExifTool executed, and what is in the target afterwards."""

    target: str
    # (tag, operator, value) per argument: operator is "=", "+=" or "-=".
    arguments: list[tuple[str, str, str]]
    output: str
    problems: list[str] = field(default_factory=list)

    @property
    def tags(self) -> set[str]:
        return {tag for tag, _, _ in self.arguments}


def _parse_write_argument(parameter: str) -> tuple[str, str, str] | None:
    if not parameter.startswith("-") or "=" not in parameter:
        return None
    name, _, value = parameter[1:].partition("=")
    if name.endswith(("+", "-")):
        return name[:-1], name[-1] + "=", value
    return name, "=", value


def _as_list(value: object) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return [str(item) for item in values]


class RecordingExifTool(exiftool.ExifTool):
    """An ExifTool process shared by every write and read of a test class.

    ``start``, ``terminate`` and the context manager are no-ops once it runs,
    so ``write_metadata`` and ``read_orientation`` (which start and stop the
    process they create) use it as it is; ``stop`` ends it for real.
    """

    def __init__(self, common_args: list[str] | None = None) -> None:
        super().__init__(EXIFTOOL, common_args=common_args)
        self.writes: list[WriteRecord] = []

    def start(self) -> None:
        if not self.running:
            super().start()

    def terminate(self, wait_timeout: int = 30) -> None:
        """Owned by the test class; see ``stop``."""

    def stop(self) -> None:
        exiftool.ExifTool.terminate(self)

    def __enter__(self) -> RecordingExifTool:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        return None

    def execute(self, *params: bytes) -> bytes:
        output = super().execute(*params)
        if b"-overwrite_original" in params:
            self.writes.append(self._check_write(params, output))
        return output

    def prepare(self, path: str, *arguments: str) -> None:
        """Tag a fixture, without recording it as a write under test."""
        output = exiftool.ExifTool.execute(
            self,
            *(os.fsencode(argument) for argument in arguments),
            b"-overwrite_original",
            os.fsencode(path),
        )
        if not output.strip().startswith(WRITE_LANDED):
            raise RuntimeError(f"could not tag fixture {path}: {output!r}")

    def read(self, path: str, *tags: str) -> dict[str, object]:
        """``tags`` as ExifTool finds them in ``path`` alone (no sidecar).

        Structures come back as structures (``-struct``), values numeric
        (``-n``). A tag missing from the file maps to None.
        """
        from service.exif.main import _attribute

        result = self.execute_json("-struct", *(f"-{tag}" for tag in tags), path)
        data = result[0] if result else {}
        values, _ = _attribute(data, list(tags))
        return dict(zip(tags, values))

    def _check_write(self, params: tuple[bytes, ...], output: bytes) -> WriteRecord:
        target = os.fsdecode(params[-1])
        arguments = [
            parsed
            for parsed in (_parse_write_argument(os.fsdecode(p)) for p in params[:-1])
            if parsed is not None
        ]
        record = WriteRecord(target, arguments, output.decode("utf-8", "replace"))
        if not output.strip().startswith(WRITE_LANDED):
            record.problems.append(
                f"ExifTool did not update {target}: {record.output.strip()!r}"
            )
        if not os.path.exists(target):
            record.problems.append(f"{target} does not exist after the write")
            return record
        on_disk = self.read(target, *sorted(record.tags))
        for tag, operator, value in arguments:
            if operator == "-=" or value == "":
                continue  # a removal or a delete: nothing to find
            found = on_disk[tag]
            if found is None:
                record.problems.append(f"{tag} is not in {target} after the write")
            elif not value.startswith("{") and value not in _as_list(found):
                record.problems.append(
                    f"{tag} reads back as {found!r} from {target}, not {value!r}"
                )
        return record


class _ServiceAnswer:
    def __init__(self, payload: object) -> None:
        self._payload = payload

    def json(self) -> object:
        return self._payload


def _exif_service_post(
    service: str, path: str, *, json: object, timeout: object = None
) -> _ServiceAnswer:
    """``sidecars.post`` for the exif service, answered by its Flask route in process."""
    from service.exif.main import app

    if service != "exif":
        raise AssertionError(f"unexpected sidecar call to {service}{path}")
    response = app.test_client().post(path, json=json)
    if response.status_code >= 400:
        raise requests.HTTPError(f"exif service answered {response.status_code}")
    return _ServiceAnswer(response.get_json())


def media_root(library: str) -> str:
    root = os.path.join(library, "protected_media")
    for folder in ("thumbnails_big", "square_thumbnails", "square_thumbnails_small"):
        os.makedirs(os.path.join(root, folder), exist_ok=True)
    return root


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class RealExifToolTestCase(TestCase):
    """A TestCase whose metadata writes and reads run against real ExifTool.

    ``self.library`` is a temporary directory for the media files and
    MEDIA_ROOT (thumbnails) points inside it.
    """

    exiftool: RecordingExifTool
    struct_exiftool: RecordingExifTool
    library: str

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        from service.exif import main as exif_service

        cls.exiftool = RecordingExifTool()
        cls.struct_exiftool = RecordingExifTool(["-struct"])
        for instance in (cls.exiftool, cls.struct_exiftool):
            instance.start()
            cls.addClassCleanup(instance.stop)
        cls.library = tempfile.mkdtemp(prefix="librephotos-exiftool-")
        cls.addClassCleanup(shutil.rmtree, cls.library, True)

        shared = cls.exiftool

        def shared_exiftool(*args: object, **kwargs: object) -> RecordingExifTool:
            return shared

        patchers = [
            patch(
                "api.metadata.reader.sidecars",
                SimpleNamespace(
                    post=_exif_service_post, error_detail=sidecars.error_detail
                ),
            ),
            patch(
                "api.metadata.writer.exiftool",
                SimpleNamespace(ExifTool=shared_exiftool),
            ),
            patch.object(exif_service, "static_et", cls.exiftool),
            patch.object(exif_service, "static_struct_et", cls.struct_exiftool),
        ]
        for patcher in patchers:
            patcher.start()
            cls.addClassCleanup(patcher.stop)
        settings = override_settings(MEDIA_ROOT=media_root(cls.library))
        settings.enable()
        cls.addClassCleanup(settings.disable)

    def setUp(self) -> None:
        super().setUp()
        self.exiftool.writes.clear()
        self.directory = tempfile.mkdtemp(dir=self.library)

    # ---- fixtures -------------------------------------------------------

    def make_image(self, extension: str = ".jpg", name: str = "photo") -> str:
        """A ``WIDTH`` x ``HEIGHT`` image in ``STORED_LAYOUT``, untagged."""
        path = os.path.join(self.directory, name + extension)
        quadrants = PIL.Image.new("RGB", (WIDTH, HEIGHT))
        half_w, half_h = WIDTH // 2, HEIGHT // 2
        for index, colour in enumerate(STORED_LAYOUT):
            left, top = (index % 2) * half_w, (index // 2) * half_h
            quadrants.paste(QUADRANTS[colour], (left, top, left + half_w, top + half_h))
        if extension in (".heic", ".heif") and not heic_encoder():
            raise unittest.SkipTest("this pillow-heif build has no HEVC encoder")
        quadrants.save(path)
        return path

    def make_video(self, name: str = "clip") -> str:
        """One second of black, 64x48, H.264 in MP4."""
        if not FFMPEG:
            raise unittest.SkipTest("ffmpeg not available")
        path = os.path.join(self.directory, name + ".mp4")
        result = subprocess.run(
            [
                FFMPEG,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=black:s=64x48:d=1:r=5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
                path,
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            raise unittest.SkipTest(
                f"ffmpeg cannot encode H.264 here: {result.stderr!r}"
            )
        return path

    def tag(self, path: str, *arguments: str) -> None:
        """Write fixture tags (``"-Orientation#=6"``, ...) without recording them."""
        self.exiftool.prepare(path, *arguments)

    def photo_for(
        self,
        path: str,
        owner: User,
        thumbnails: bool = False,
        **fields: object,
    ) -> Photo:
        """A Photo of ``owner`` whose main file is ``path``."""
        photo = create_test_photo(owner=owner, **fields)
        photo.main_file = File.create(path, owner)
        photo.save(save_metadata=False)
        if thumbnails:
            photo.thumbnail._generate_thumbnail()
        # From the database, as a request would load it: Photo.save() diffs
        # against the row it was loaded from.
        return Photo.objects.select_related("main_file", "owner").get(pk=photo.pk)

    # ---- reading back ---------------------------------------------------

    def read_tags(self, path: str, *tags: str) -> dict[str, object]:
        return self.exiftool.read(path, *tags)

    def sidecar_of(self, path: str) -> str:
        return get_sidecar_files_in_priority_order(path)[0]

    def assertWritesLanded(self, expected: int | None = None) -> None:
        """Every recorded write reached its target with every tag it was given."""
        writes = self.exiftool.writes
        if expected is not None:
            self.assertEqual(
                expected,
                len(writes),
                f"expected {expected} ExifTool write(s), got "
                f"{[(w.target, w.arguments) for w in writes]}",
            )
        problems = [problem for write in writes for problem in write.problems]
        self.assertEqual([], problems)

    @contextmanager
    def assertUntouched(self, path: str) -> Iterator[None]:
        """The block leaves ``path`` byte-identical and creates no sidecar."""
        with open(path, "rb") as handle:
            before = handle.read()
        writes_before = len(self.exiftool.writes)
        yield
        with open(path, "rb") as handle:
            self.assertEqual(before, handle.read(), f"{path} was rewritten")
        sidecars_now = [
            sidecar
            for sidecar in get_sidecar_files_in_priority_order(path)
            if os.path.exists(sidecar)
        ]
        self.assertEqual([], sidecars_now, "a sidecar was created")
        self.assertEqual(
            [],
            self.exiftool.writes[writes_before:],
            "ExifTool wrote something",
        )


# ---- pictures ----------------------------------------------------------


def heic_encoder() -> bool:
    """Register pillow-heif with Pillow; whether it can also encode HEIC."""
    import pillow_heif

    pillow_heif.register_heif_opener()
    return bool(pillow_heif.libheif_info().get("HEIF"))


def stored_pixels(path: str) -> pyvips.Image:
    """The pixels as stored in ``path``, before any orientation is applied."""
    import numpy as np
    import pyvips

    heic_encoder()  # registers the HEIF opener
    with PIL.Image.open(path) as image:
        array = np.asarray(image.convert("RGB"))
    return pyvips.Image.new_from_array(array)


def autorotated(image: pyvips.Image, orientation: int) -> pyvips.Image:
    """``image`` as libvips' own ``autorot()`` shows it under ``orientation``."""
    import pyvips

    tagged = image.copy()
    tagged.set_type(pyvips.GValue.gint_type, "orientation", orientation)
    return tagged.autorot()


def load(path: str) -> pyvips.Image:
    """A thumbnail (or any image libvips reads), without libvips' file cache."""
    import pyvips

    with open(path, "rb") as handle:
        return pyvips.Image.new_from_buffer(handle.read(), "")


def layout(image: pyvips.Image) -> tuple[str, str, str, str, str]:
    """Portrait or landscape, then the quadrant colours left to right, top to bottom."""
    width, height = image.width, image.height
    colours: list[str] = []
    for fy in (0.25, 0.75):
        for fx in (0.25, 0.75):
            pixel = image.getpoint(int(width * fx), int(height * fy))[:3]
            colours.append(
                min(
                    QUADRANTS,
                    key=lambda name: sum(
                        (a - b) ** 2 for a, b in zip(QUADRANTS[name], pixel)
                    ),
                )
            )
    shape = "portrait" if height > width else "landscape"
    return (shape, colours[0], colours[1], colours[2], colours[3])


def shown_layout(path: str, orientation: int) -> tuple[str, str, str, str, str]:
    """The layout a viewer shows for ``path`` under the EXIF ``orientation``."""
    return layout(autorotated(stored_pixels(path), orientation))
