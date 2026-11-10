"""The chunked upload's state machine: UPLOADING, COMPLETE, deleted.

Every move is a conditional update on the row, so two requests that read it
at the same time cannot both make the same move: two chunks at one offset
are not both written, two completions do not both import, and a stale chunk
request cannot write a completed upload back to UPLOADING. Expiry counts from
the upload's last activity, not from its creation.

The interleavings are driven by hand: the second request runs inside a hook
of the first, after the first has read the row.
"""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from api.tests.uploads.test_chunked_upload_views import (
    CHUNK,
    ChunkedUploadViewTestBase,
    WorkingChunkedUploadView,
    chunk_file,
    upload_request,
)
from chunked_upload.cleanup import delete_expired_uploads
from chunked_upload.constants import COMPLETE, UPLOADING
from chunked_upload.exceptions import ChunkedUploadError
from chunked_upload.models import ChunkedUpload
from chunked_upload.settings import EXPIRATION_DELTA
from chunked_upload.views import ChunkedUploadCompleteView


def outcome(view, request):
    """The status code ``view`` answers ``request`` with."""
    try:
        return view._post(request).status_code
    except ChunkedUploadError as error:
        return error.status_code


def staged_bytes(upload):
    with open(upload.file.path, "rb") as handle:
        return handle.read()


def idle_for(upload, age):
    ChunkedUpload.objects.filter(pk=upload.pk).update(
        created_on=timezone.now() - age, updated_on=timezone.now() - age
    )


class ChunkTransitionTest(ChunkedUploadViewTestBase):
    view_class = WorkingChunkedUploadView

    def chunk_request(self, upload, content, content_range="bytes 5-9/10"):
        return upload_request(
            data={"upload_id": upload.upload_id},
            files={"file": chunk_file(content)},
            content_range=content_range,
        )

    def test_two_chunks_at_the_same_offset_are_written_once(self):
        upload = self.make_upload(content=b"AAAAA")
        first_request = self.chunk_request(upload, b"BBBBB")
        second_request = self.chunk_request(upload, b"CCCCC")
        first = self.make_view(first_request)
        second = self.make_view(second_request)
        statuses = []
        check_chunk = first.check_chunk

        def check_then_let_the_second_in(*args):
            check_chunk(*args)
            statuses.append(outcome(second, second_request))

        first.check_chunk = check_then_let_the_second_in
        statuses.append(outcome(first, first_request))

        self.assertEqual([200, 400], statuses)
        upload.refresh_from_db()
        self.assertEqual(10, upload.offset)
        self.assertEqual(b"AAAAACCCCC", staged_bytes(upload))

    def test_a_chunk_that_read_the_row_before_completion_cannot_reopen_it(self):
        upload = self.make_upload(content=b"AAAAA")
        chunk_request = self.chunk_request(upload, b"BBBBB")
        chunk_view = self.make_view(chunk_request)
        complete_request = upload_request(
            data={"upload_id": upload.upload_id, "md5": upload.md5}
        )
        complete_view = ChunkedUploadCompleteView()
        complete_view.request = complete_request
        check_chunk = chunk_view.check_chunk

        def check_then_complete(*args):
            check_chunk(*args)
            self.assertEqual(200, outcome(complete_view, complete_request))

        chunk_view.check_chunk = check_then_complete

        self.assertEqual(400, outcome(chunk_view, chunk_request))
        upload.refresh_from_db()
        self.assertEqual((COMPLETE, 5), (upload.status, upload.offset))
        self.assertEqual(b"AAAAA", staged_bytes(upload))

    def test_a_failed_write_gives_the_offset_back_for_a_retry(self):
        upload = self.make_upload(content=b"AAAAA")
        request = self.chunk_request(upload, b"BBBBB")
        with patch.object(ChunkedUpload, "write_chunk", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                self.make_view(request)._post(request)
        upload.refresh_from_db()
        self.assertEqual(5, upload.offset)

        retry = self.chunk_request(upload, b"BBBBB")
        self.assertEqual(200, outcome(self.make_view(retry), retry))
        self.assertEqual(b"AAAAABBBBB", staged_bytes(upload))

    def test_a_long_upload_that_keeps_sending_chunks_does_not_expire(self):
        upload = self.make_upload(content=b"AAAAA")
        ChunkedUpload.objects.filter(pk=upload.pk).update(
            created_on=timezone.now() - EXPIRATION_DELTA - timedelta(hours=1)
        )
        request = self.chunk_request(upload, b"BBBBB")

        self.assertEqual(200, outcome(self.make_view(request), request))

        self.assertEqual({UPLOADING: 0, COMPLETE: 0}, delete_expired_uploads())
        self.assertTrue(ChunkedUpload.objects.filter(pk=upload.pk).exists())

    def test_an_upload_idle_past_the_expiry_is_gone(self):
        upload = self.make_upload(content=b"AAAAA")
        idle_for(upload, EXPIRATION_DELTA + timedelta(minutes=1))
        request = self.chunk_request(upload, b"BBBBB")

        self.assertEqual(410, outcome(self.make_view(request), request))


class CompleteTransitionTest(ChunkedUploadViewTestBase):
    view_class = ChunkedUploadCompleteView

    def complete_request(self, upload):
        return upload_request(data={"upload_id": upload.upload_id, "md5": upload.md5})

    def test_two_completions_import_once(self):
        upload = self.make_upload(content=CHUNK)
        first_request = self.complete_request(upload)
        second_request = self.complete_request(upload)
        first = self.make_view(first_request)
        second = self.make_view(second_request)
        imported = []
        first.on_completion = second.on_completion = lambda file, request: (
            imported.append(request)
        )
        statuses = []
        is_valid = first.is_valid_chunked_upload

        def validate_then_let_the_second_in(chunked_upload):
            is_valid(chunked_upload)
            statuses.append(outcome(second, second_request))

        first.is_valid_chunked_upload = validate_then_let_the_second_in
        statuses.append(outcome(first, first_request))

        self.assertEqual([200, 400], statuses)
        self.assertEqual([second_request], imported)

    def test_any_failure_of_the_completion_reopens_the_upload(self):
        upload = self.make_upload(content=CHUNK)
        request = self.complete_request(upload)
        view = self.make_view(request)

        def disk_full(uploaded_file, request):
            uploaded_file.close()
            raise OSError("No space left on device")

        view.on_completion = disk_full

        with self.assertRaises(OSError):
            view._post(request)

        upload.refresh_from_db()
        self.assertEqual((UPLOADING, None), (upload.status, upload.completed_on))
        retry = self.complete_request(upload)
        self.assertEqual(200, outcome(self.make_view(retry), retry))

    def test_an_upload_idle_past_the_expiry_cannot_be_completed(self):
        upload = self.make_upload(content=CHUNK)
        idle_for(upload, EXPIRATION_DELTA + timedelta(minutes=1))
        request = self.complete_request(upload)

        self.assertEqual(410, outcome(self.make_view(request), request))
        upload.refresh_from_db()
        self.assertEqual(UPLOADING, upload.status)

    def test_completing_counts_as_activity(self):
        upload = self.make_upload(content=CHUNK)
        idle_for(upload, EXPIRATION_DELTA - timedelta(minutes=1))
        request = self.complete_request(upload)
        view = self.make_view(request)
        view.on_completion = lambda file, request: file.close()

        self.assertEqual(200, outcome(view, request))

        self.assertEqual({UPLOADING: 0, COMPLETE: 0}, delete_expired_uploads())


class CleanupTransitionTest(ChunkedUploadViewTestBase):
    def test_an_upload_that_got_a_chunk_after_the_sweep_read_it_is_kept(self):
        upload = self.make_upload(content=b"AAAAA")
        idle_for(upload, EXPIRATION_DELTA + timedelta(minutes=1))
        request = upload_request(
            data={"upload_id": upload.upload_id},
            files={"file": chunk_file(b"BBBBB")},
            content_range="bytes 5-9/10",
        )

        def a_chunk_arrives(chunked_upload):
            ChunkedUpload.objects.filter(pk=chunked_upload.pk).update(
                updated_on=timezone.now()
            )
            return True

        self.assertEqual(
            {UPLOADING: 0, COMPLETE: 0}, delete_expired_uploads(a_chunk_arrives)
        )
        self.assertTrue(ChunkedUpload.objects.filter(pk=upload.pk).exists())
        self.assertEqual(
            200, outcome(WorkingChunkedUploadView(request=request), request)
        )
