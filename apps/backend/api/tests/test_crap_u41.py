"""Characterization tests for ``chunked_upload.views``.

Pins the CURRENT behavior of:
  * ``ChunkedUploadView._post``          (chunk receive / resume)
  * ``ChunkedUploadCompleteView._post``  (finalize upload)

Everything is driven through ``RequestFactory`` against a temporary
``MEDIA_ROOT``; ``_post`` is called directly so that permission checking
(exercised elsewhere) does not interfere. No ML models, network or exiftool
binaries are involved.

Quirks pinned here that a refactor must preserve:
  * ``get_object_or_404`` raises ``Http404`` -- it is NOT converted into a
    ``ChunkedUploadError``/JSON response by ``post()``.
  * In ``ChunkedUploadCompleteView._post`` the object is looked up *before*
    ``validate()`` and ``is_valid_chunked_upload()`` run.
  * The "Offsets do not match" error carries an extra ``offset`` key in its
    payload; every other error payload only has ``detail``.
  * With ``do_md5_check = False`` an ``md5`` POST value is ignored entirely.
  * ``ChunkedUploadView.create_chunked_upload`` is BROKEN under this project's
    settings (``CHUNKED_UPLOAD_TO = "chunked_uploads"``): saving the empty
    placeholder with ``name=""`` raises ``SuspiciousFileOperation``. That is why
    ``api.views.upload.UploadPhotosChunked`` overrides it with ``name="tmp"``.
    Pinned by ``test_base_create_chunked_upload_is_broken_with_empty_name``; the
    remaining tests use a subclass with the working override, exactly like the
    production subclass.
"""

import json
import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import Http404
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from api.tests.utils import create_test_user
from chunked_upload.constants import COMPLETE, UPLOADING
from chunked_upload.exceptions import ChunkedUploadError
from chunked_upload.models import ChunkedUpload
from chunked_upload.views import ChunkedUploadCompleteView, ChunkedUploadView

CHUNK = b"0123456789"


def upload_request(data=None, files=None, content_range=None, user=None):
    payload = dict(data or {})
    payload.update(files or {})
    extra = {}
    if content_range is not None:
        extra["HTTP_CONTENT_RANGE"] = content_range
    request = RequestFactory().post("/api/chunked_upload/", payload, **extra)
    if user is not None:
        request.user = user
    return request


def chunk_file(content=CHUNK, name="photo.jpg"):
    return SimpleUploadedFile(name, content, content_type="image/jpeg")


class WorkingChunkedUploadView(ChunkedUploadView):
    """``ChunkedUploadView`` with the same ``create_chunked_upload`` override
    that ``api.views.upload.UploadPhotosChunked`` needs to work at all."""

    def create_chunked_upload(self, save=False, **attrs):
        chunked_upload = self.model(**attrs)
        chunked_upload.file.save(name="tmp", content=ContentFile(""), save=save)
        return chunked_upload


class ChunkedUploadViewTestBase(TestCase):
    view_class = WorkingChunkedUploadView

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp(prefix="crap-u41-")
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._media_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls._media_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)
        super().tearDownClass()

    def make_view(self, request, **attrs):
        view = self.view_class()
        for key, value in attrs.items():
            setattr(view, key, value)
        view.request = request
        return view

    def make_upload(self, user=None, content=b"", filename="photo.jpg"):
        """Create a persisted ChunkedUpload whose backing file exists on disk."""
        view = WorkingChunkedUploadView()
        attrs = {"filename": filename}
        if user is not None:
            attrs["user"] = user
        upload = view.create_chunked_upload(save=False, **attrs)
        upload.save()
        if content:
            upload.append_chunk(chunk_file(content), chunk_size=len(content))
            upload.save()
        return upload


class ChunkedUploadViewPostTest(ChunkedUploadViewTestBase):
    """``ChunkedUploadView._post``."""

    def test_base_create_chunked_upload_is_broken_with_empty_name(self):
        """Known bug: the un-overridden base implementation cannot save."""
        view = ChunkedUploadView()
        with self.assertRaises(SuspiciousFileOperation):
            view.create_chunked_upload(save=False, filename="photo.jpg")

    # ------------------------------------------------------------------ chunk
    def test_missing_chunk_file_raises_400(self):
        request = upload_request(data={"upload_id": "x"})
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.data, {"detail": "No chunk file was submitted"})

    def test_missing_chunk_file_is_rendered_as_json_by_post(self):
        request = upload_request()
        view = self.make_view(request)
        view.check_permissions = lambda req: None
        response = view.post(request)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(
            json.loads(response.content), {"detail": "No chunk file was submitted"}
        )

    def test_validate_is_called_after_chunk_presence_check(self):
        calls = []
        request = upload_request(files={"file": chunk_file()})
        view = self.make_view(request)
        view.validate = lambda req: calls.append(req)
        view._post(request)
        self.assertEqual(len(calls), 1)

    def test_validate_may_abort_the_upload(self):
        request = upload_request(files={"file": chunk_file()})
        view = self.make_view(request)

        def boom(req):
            raise ChunkedUploadError(status=418, detail="nope")

        view.validate = boom
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 418)
        self.assertEqual(ChunkedUpload.objects.count(), 0)

    # ------------------------------------------------------------ new uploads
    def test_new_upload_happy_path_without_content_range(self):
        request = upload_request(files={"file": chunk_file()})
        view = self.make_view(request)
        response = view._post(request)

        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(set(body), {"upload_id", "offset", "expires"})

        upload = ChunkedUpload.objects.get(upload_id=body["upload_id"])
        self.assertEqual(upload.offset, len(CHUNK))
        self.assertEqual(body["offset"], len(CHUNK))
        self.assertEqual(upload.filename, "photo.jpg")
        self.assertEqual(upload.status, UPLOADING)
        self.assertIsNone(upload.user)
        with open(upload.file.path, "rb") as handle:
            self.assertEqual(handle.read(), CHUNK)

    def test_new_upload_records_authenticated_user_and_pre_post_save_hooks(self):
        user = create_test_user()
        request = upload_request(files={"file": chunk_file()}, user=user)
        view = self.make_view(request)
        seen = []
        view.pre_save = lambda cu, req, new=False: seen.append(("pre", new))
        view.post_save = lambda cu, req, new=False: seen.append(("post", new))

        response = view._post(request)
        self.assertEqual(response.status_code, 200)
        upload = ChunkedUpload.objects.get()
        self.assertEqual(upload.user, user)
        # ``new`` is computed from ``id is None`` *before* save(), so it is True
        self.assertEqual(seen, [("pre", True), ("post", True)])

    def test_new_upload_with_content_range_header(self):
        request = upload_request(
            files={"file": chunk_file()}, content_range="bytes 0-9/50"
        )
        view = self.make_view(request)
        response = view._post(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ChunkedUpload.objects.get().offset, 10)

    def test_malformed_content_range_falls_back_to_whole_chunk(self):
        request = upload_request(
            files={"file": chunk_file()}, content_range="bytes garbage"
        )
        view = self.make_view(request)
        response = view._post(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ChunkedUpload.objects.get().offset, len(CHUNK))

    def test_missing_header_with_fail_if_no_header_raises_400(self):
        request = upload_request(files={"file": chunk_file()})
        view = self.make_view(request, fail_if_no_header=True)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.data, {"detail": "Error in request headers"})

    # ---------------------------------------------------------------- resume
    def test_resume_existing_upload_appends_chunk(self):
        upload = self.make_upload(content=b"AAAAA")
        request = upload_request(
            data={"upload_id": upload.upload_id},
            files={"file": chunk_file(b"BBBBB")},
            content_range="bytes 5-9/10",
        )
        view = self.make_view(request)
        response = view._post(request)

        self.assertEqual(response.status_code, 200)
        upload.refresh_from_db()
        self.assertEqual(upload.offset, 10)
        with open(upload.file.path, "rb") as handle:
            self.assertEqual(handle.read(), b"AAAAABBBBB")
        self.assertEqual(ChunkedUpload.objects.count(), 1)

    def test_unknown_upload_id_raises_http404_not_chunked_upload_error(self):
        request = upload_request(
            data={"upload_id": "deadbeef" * 4}, files={"file": chunk_file()}
        )
        view = self.make_view(request)
        with self.assertRaises(Http404):
            view._post(request)

    def test_upload_owned_by_another_user_is_not_visible(self):
        owner = create_test_user()
        other = create_test_user()
        upload = self.make_upload(user=owner)
        request = upload_request(
            data={"upload_id": upload.upload_id},
            files={"file": chunk_file()},
            user=other,
        )
        view = self.make_view(request)
        with self.assertRaises(Http404):
            view._post(request)

    def test_expired_upload_raises_410(self):
        upload = self.make_upload()
        request = upload_request(
            data={"upload_id": upload.upload_id}, files={"file": chunk_file()}
        )
        view = self.make_view(request)
        with patch("chunked_upload.models.EXPIRATION_DELTA", timedelta(days=-1)):
            with self.assertRaises(ChunkedUploadError) as ctx:
                view._post(request)
        self.assertEqual(ctx.exception.status_code, 410)
        self.assertEqual(ctx.exception.data, {"detail": "Upload has expired"})

    def test_completed_upload_raises_400(self):
        upload = self.make_upload()
        upload.status = COMPLETE
        upload.save()
        request = upload_request(
            data={"upload_id": upload.upload_id}, files={"file": chunk_file()}
        )
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.data,
            {"detail": 'Upload has already been marked as "complete"'},
        )

    # --------------------------------------------------------------- limits
    def test_total_over_max_bytes_raises_400(self):
        request = upload_request(
            files={"file": chunk_file()}, content_range="bytes 0-9/500"
        )
        view = self.make_view(request, max_bytes=100)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.data,
            {"detail": "Size of file exceeds the limit (100 bytes)"},
        )

    def test_total_equal_to_max_bytes_is_allowed(self):
        request = upload_request(
            files={"file": chunk_file()}, content_range="bytes 0-9/10"
        )
        view = self.make_view(request, max_bytes=10)
        self.assertEqual(view._post(request).status_code, 200)

    def test_offset_mismatch_raises_400_with_offset_payload(self):
        upload = self.make_upload(content=b"AAAAA")
        request = upload_request(
            data={"upload_id": upload.upload_id},
            files={"file": chunk_file(b"BBBBB")},
            content_range="bytes 0-4/10",
        )
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.data, {"detail": "Offsets do not match", "offset": 5}
        )

    def test_chunk_size_mismatch_raises_400(self):
        request = upload_request(
            files={"file": chunk_file()}, content_range="bytes 0-4/10"
        )
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.data, {"detail": "File size doesn't match headers"}
        )
        self.assertEqual(ChunkedUpload.objects.count(), 0)

    def test_max_bytes_check_precedes_offset_check(self):
        upload = self.make_upload(content=b"AAAAA")
        request = upload_request(
            data={"upload_id": upload.upload_id},
            files={"file": chunk_file(b"BBBBB")},
            content_range="bytes 0-4/999",
        )
        view = self.make_view(request, max_bytes=10)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertIn("exceeds the limit", ctx.exception.data["detail"])


class ChunkedUploadCompleteViewPostTest(ChunkedUploadViewTestBase):
    """``ChunkedUploadCompleteView._post``."""

    view_class = ChunkedUploadCompleteView

    def complete_request(self, upload_id=None, md5=None, user=None):
        data = {}
        if upload_id is not None:
            data["upload_id"] = upload_id
        if md5 is not None:
            data["md5"] = md5
        return upload_request(data=data, user=user)

    # ------------------------------------------------------------ validation
    def test_missing_both_params_raises_400(self):
        request = self.complete_request()
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.data, {"detail": "Both 'upload_id' and 'md5' are required"}
        )

    def test_missing_md5_raises_400_when_md5_check_enabled(self):
        upload = self.make_upload(content=CHUNK)
        request = self.complete_request(upload_id=upload.upload_id)
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(
            ctx.exception.data, {"detail": "Both 'upload_id' and 'md5' are required"}
        )

    def test_empty_string_params_are_falsy_and_rejected(self):
        request = self.complete_request(upload_id="", md5="")
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(
            ctx.exception.data, {"detail": "Both 'upload_id' and 'md5' are required"}
        )

    def test_missing_upload_id_without_md5_check_raises_400(self):
        request = self.complete_request(md5="whatever")
        view = self.make_view(request, do_md5_check=False)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.data, {"detail": "'upload_id' is required"})

    def test_md5_is_ignored_when_md5_check_disabled(self):
        upload = self.make_upload(content=CHUNK)
        request = self.complete_request(upload_id=upload.upload_id, md5="bogus")
        view = self.make_view(request, do_md5_check=False)
        response = view._post(request)
        self.assertEqual(response.status_code, 200)
        upload.refresh_from_db()
        self.assertEqual(upload.status, COMPLETE)

    # --------------------------------------------------------------- lookup
    def test_unknown_upload_id_raises_http404(self):
        request = self.complete_request(upload_id="deadbeef" * 4, md5="x")
        view = self.make_view(request)
        with self.assertRaises(Http404):
            view._post(request)

    def test_upload_owned_by_another_user_raises_http404(self):
        owner = create_test_user()
        other = create_test_user()
        upload = self.make_upload(user=owner, content=CHUNK)
        request = self.complete_request(
            upload_id=upload.upload_id, md5=upload.md5, user=other
        )
        view = self.make_view(request)
        with self.assertRaises(Http404):
            view._post(request)

    def test_lookup_happens_before_validate(self):
        """Quirk: an unknown id 404s even though validate() would have failed."""
        calls = []
        request = self.complete_request(upload_id="deadbeef" * 4, md5="x")
        view = self.make_view(request)
        view.validate = lambda req: calls.append(req)
        with self.assertRaises(Http404):
            view._post(request)
        self.assertEqual(calls, [])

    def test_validate_runs_before_status_and_md5_checks(self):
        upload = self.make_upload(content=CHUNK)
        upload.status = COMPLETE
        upload.save()
        request = self.complete_request(upload_id=upload.upload_id, md5="bogus")
        view = self.make_view(request)

        def boom(req):
            raise ChunkedUploadError(status=418, detail="validate first")

        view.validate = boom
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 418)

    def test_already_complete_raises_400(self):
        upload = self.make_upload(content=CHUNK)
        upload.status = COMPLETE
        upload.save()
        request = self.complete_request(upload_id=upload.upload_id, md5=upload.md5)
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.data,
            {"detail": "Upload has already been marked as complete"},
        )

    def test_md5_mismatch_raises_400_and_leaves_status_untouched(self):
        upload = self.make_upload(content=CHUNK)
        request = self.complete_request(upload_id=upload.upload_id, md5="not-the-md5")
        view = self.make_view(request)
        with self.assertRaises(ChunkedUploadError) as ctx:
            view._post(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.data, {"detail": "md5 checksum does not match"})
        upload.refresh_from_db()
        self.assertEqual(upload.status, UPLOADING)
        self.assertIsNone(upload.completed_on)

    def test_expired_uploads_are_still_completable(self):
        """Quirk: unlike ChunkedUploadView, expiry is not checked on completion."""
        upload = self.make_upload(content=CHUNK)
        request = self.complete_request(upload_id=upload.upload_id, md5=upload.md5)
        view = self.make_view(request)
        with patch("chunked_upload.models.EXPIRATION_DELTA", timedelta(days=-1)):
            response = view._post(request)
        self.assertEqual(response.status_code, 200)

    # ----------------------------------------------------------- happy path
    def test_happy_path_marks_complete_and_calls_on_completion(self):
        upload = self.make_upload(content=CHUNK)
        before = timezone.now()
        request = self.complete_request(upload_id=upload.upload_id, md5=upload.md5)
        view = self.make_view(request)
        received = []
        view.on_completion = lambda uploaded, req: received.append(uploaded)

        response = view._post(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        # Base get_response_data returns an empty dict for the complete view.
        self.assertEqual(json.loads(response.content), {})

        upload.refresh_from_db()
        self.assertEqual(upload.status, COMPLETE)
        self.assertIsNotNone(upload.completed_on)
        self.assertGreaterEqual(upload.completed_on, before)

        self.assertEqual(len(received), 1)
        uploaded_file = received[0]
        self.assertEqual(uploaded_file.name, "photo.jpg")
        self.assertEqual(uploaded_file.size, len(CHUNK))
        uploaded_file.seek(0)
        self.assertEqual(uploaded_file.read(), CHUNK)

    def test_save_hooks_receive_new_false_on_completion(self):
        upload = self.make_upload(content=CHUNK)
        request = self.complete_request(upload_id=upload.upload_id, md5=upload.md5)
        view = self.make_view(request)
        seen = []
        view.pre_save = lambda cu, req, new=False: seen.append(("pre", new))
        view.post_save = lambda cu, req, new=False: seen.append(("post", new))
        view._post(request)
        self.assertEqual(seen, [("pre", False), ("post", False)])
