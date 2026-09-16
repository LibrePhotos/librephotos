"""Tests for the admin "deduplicate faces" action enqueue behaviour.

The action hands work to django_q, which pickles the whole task (args and
kwargs included) into the broker payload. Anything lazy that is passed along,
such as a QuerySet, gets evaluated during that pickling inside the admin
request thread, which is exactly what the async wrap is supposed to avoid.
"""

import pickle
import uuid
from unittest.mock import patch

from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.db import connection
from django.db.models import QuerySet
from django.test import RequestFactory, TestCase
from django.test.utils import CaptureQueriesContext

from api import admin as admin_module
from api.admin import PhotoAdmin, deduplicate_faces_function
from api.models import Photo
from api.tests.utils import create_test_face, create_test_photos, create_test_user


class RecordingAsyncTask:
    """Stand-in for django_q's AsyncTask that records what would be enqueued."""

    calls = []

    def __init__(self, func, *args, **kwargs):
        self.func = func
        self.args = args
        self.kwargs = kwargs

    def run(self):
        RecordingAsyncTask.calls.append((self.func, self.args, self.kwargs))
        return uuid.uuid4().hex


class DeduplicateFacesActionEnqueueTest(TestCase):
    """The enqueued payload must be ids, not a materialised queryset."""

    PHOTO_COUNT = 20

    def setUp(self):
        self.user = create_test_user()
        self.photos = create_test_photos(self.PHOTO_COUNT, owner=self.user)
        self.photo_ids = {photo.id for photo in self.photos}
        self.photo_admin = PhotoAdmin(Photo, AdminSite())
        self.request = RequestFactory().post("/admin/api/photo/")
        self.request.user = self.user
        self.request.session = {}
        self.request._messages = FallbackStorage(self.request)
        RecordingAsyncTask.calls = []

    def run_action(self, queryset):
        with patch.object(admin_module, "AsyncTask", RecordingAsyncTask):
            self.photo_admin.deduplicate_faces(self.request, queryset)
        return RecordingAsyncTask.calls

    @staticmethod
    def payload_of(call):
        _func, args, kwargs = call
        return list(args) + list(kwargs.values())

    def test_enqueues_ids_and_not_a_queryset(self):
        queryset = Photo.objects.filter(owner=self.user)
        calls = self.run_action(queryset)

        self.assertTrue(calls, "no task was enqueued")
        enqueued_ids = []
        for call in calls:
            for value in self.payload_of(call):
                self.assertNotIsInstance(
                    value,
                    QuerySet,
                    "a QuerySet was handed to the broker instead of ids",
                )
                for item in value:
                    self.assertNotIsInstance(
                        item, Photo, "a Photo instance was handed to the broker"
                    )
                    enqueued_ids.append(item)
        self.assertEqual(set(enqueued_ids), self.photo_ids)

    def test_action_does_not_evaluate_the_admin_queryset(self):
        queryset = Photo.objects.filter(owner=self.user)
        calls = self.run_action(queryset)

        # django_q pickles the task before handing it to the cluster; doing so
        # must not pull every selected row into the admin request.
        for call in calls:
            pickle.dumps(self.payload_of(call))
        self.assertIsNone(
            queryset._result_cache,
            "pickling the enqueued payload evaluated the admin queryset",
        )

    def test_enqueued_payload_stays_small(self):
        queryset = Photo.objects.filter(owner=self.user)
        calls = self.run_action(queryset)

        total = sum(len(pickle.dumps(self.payload_of(call))) for call in calls)
        # A pickled Photo row costs several hundred bytes; an id costs tens.
        self.assertLess(
            total,
            100 * self.PHOTO_COUNT,
            f"payload is {total} bytes for {self.PHOTO_COUNT} photos",
        )

    def test_selection_is_split_into_bounded_chunks(self):
        queryset = Photo.objects.filter(owner=self.user)
        with patch.object(admin_module, "DEDUPLICATE_FACES_CHUNK_SIZE", 7):
            calls = self.run_action(queryset)

        chunks = [self.payload_of(call)[0] for call in calls]
        self.assertEqual(len(chunks), 3)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 7)
        flattened = [photo_id for chunk in chunks for photo_id in chunk]
        self.assertEqual(len(flattened), self.PHOTO_COUNT)
        self.assertEqual(set(flattened), self.photo_ids)

    def test_action_reports_back_to_the_admin(self):
        queryset = Photo.objects.filter(owner=self.user)
        self.run_action(queryset)
        messages = [str(message) for message in self.request._messages]
        self.assertTrue(messages, "the admin got no feedback")


class DeduplicateFacesFunctionQueryCountTest(TestCase):
    """The task itself must not issue a query per photo."""

    def setUp(self):
        self.user = create_test_user()

    def make_photos_with_duplicate_faces(self, count):
        photos = create_test_photos(count, owner=self.user)
        for photo in photos:
            create_test_face(
                photo=photo,
                location_top=100,
                location_right=300,
                location_bottom=300,
                location_left=100,
            )
            create_test_face(
                photo=photo,
                location_top=110,
                location_right=310,
                location_bottom=310,
                location_left=110,
            )
        return photos

    def count_queries(self, count):
        photos = self.make_photos_with_duplicate_faces(count)
        photo_ids = [photo.id for photo in photos]
        with CaptureQueriesContext(connection) as captured:
            deduplicate_faces_function(photo_ids)
        for photo in photos:
            self.assertEqual(photo.faces.count(), 1)
        return len(captured.captured_queries)

    def test_query_count_does_not_grow_with_the_number_of_photos(self):
        for_two = self.count_queries(2)
        for_ten = self.count_queries(10)
        self.assertEqual(
            for_two,
            for_ten,
            f"{for_two} queries for 2 photos but {for_ten} for 10",
        )
