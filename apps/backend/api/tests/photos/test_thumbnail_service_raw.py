"""The RAW thumbnail sidecar: LibRaw output goes through pyvips to a WebP of the requested height."""

import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pyvips

from service.thumbnail.main import app, render_raw


class FakeRaw:
    """Stands in for rawpy.imread(): a 400x300 sensor whose demosaic is a flat colour."""

    calls = []

    def __init__(self, path):
        self.sizes = SimpleNamespace(width=400, height=300)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def postprocess(self, **kwargs):
        FakeRaw.calls.append(kwargs)
        h, w = (150, 200) if kwargs.get("half_size") else (300, 400)
        rgb = np.zeros((h, w, 3), dtype=np.uint8)
        rgb[..., 0] = 200
        return rgb


def _load(path):
    with open(path, "rb") as handle:  # from bytes: pyvips would keep the file open
        return pyvips.Image.new_from_buffer(handle.read(), "")


class RenderRawTests(unittest.TestCase):
    def setUp(self):
        FakeRaw.calls.clear()
        self.out = os.path.join(tempfile.mkdtemp(), "thumb.webp")
        self.addCleanup(lambda: os.path.exists(self.out) and os.remove(self.out))

    def test_writes_webp_at_requested_height_keeping_aspect(self):
        with patch("service.thumbnail.main.rawpy.imread", FakeRaw):
            render_raw("/photos/x.nef", self.out, 75)
        image = _load(self.out)
        self.assertEqual((image.width, image.height), (100, 75))
        self.assertTrue(image.get("vips-loader").startswith("webpload"))
        self.assertTrue(FakeRaw.calls[0]["half_size"])
        self.assertTrue(FakeRaw.calls[0]["use_camera_wb"])

    def test_full_demosaic_when_half_size_would_be_too_small(self):
        with patch("service.thumbnail.main.rawpy.imread", FakeRaw):
            render_raw("/photos/x.nef", self.out, 200)
        self.assertFalse(FakeRaw.calls[0]["half_size"])
        self.assertEqual(_load(self.out).height, 200)

    def test_endpoint_returns_destination(self):
        client = app.test_client()
        with patch("service.thumbnail.main.rawpy.imread", FakeRaw):
            response = client.post(
                "/",
                json={"source": "/photos/x.nef", "destination": self.out, "height": 30},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json(), {"thumbnail": self.out})
        self.assertTrue(os.path.exists(self.out))

    def test_bad_request_without_fields(self):
        self.assertEqual(app.test_client().post("/", json={}).status_code, 400)
