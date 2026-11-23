import random
import unittest
import uuid
from datetime import UTC, datetime, timedelta
from itertools import accumulate
from typing import Any
from unittest import mock

from django.apps import apps
from django.db import DatabaseError, connection
from django.db.models.signals import post_migrate
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.directory_watcher import processing_jobs
from api.directory_watcher import utils as job_utils
from api.models import Face, LongRunningJob, Person, Photo, Thumbnail, User
from api.runtime import planner_stats
from api.tests.utils import create_test_job, create_test_user

ON_SQLITE = connection.vendor == "sqlite"
TAKEN = datetime(2020, 1, 1, tzinfo=UTC)


def add_photos(owner: User, count: int) -> list[Photo]:
    photos = [
        Photo(
            id=photo_id,
            image_hash=f"{photo_id.hex}{owner.id}",
            added_on=TAKEN + timedelta(minutes=index),
            owner=owner,
            removed=index % 100 == 0,
            hidden=index % 200 == 1,
        )
        for index, photo_id in enumerate(uuid.uuid4() for _ in range(count))
    ]
    Photo.objects.bulk_create(
        photos, batch_size=500
    )  # raw-create: thousands of rows for the planner
    Thumbnail.objects.bulk_create(  # raw-create: thousands of rows for the planner
        [
            Thumbnail(
                photo_id=photo.id,
                thumbnail_big=f"thumbnails_big/{photo.id}.webp",
                square_thumbnail=f"square_thumbnails/{photo.id}.webp",
                square_thumbnail_small=f"square_thumbnails_small/{photo.id}.webp",
                aspect_ratio=1.5,
            )
            for photo in photos
        ],
        batch_size=500,
    )
    return photos


def add_faces(
    owner: User, photos: list[Photo], people: int, faces: int
) -> list[Person]:
    persons = (
        Person.objects.bulk_create(  # raw-create: thousands of rows for the planner
            [
                Person(
                    name=f"Person {index}", kind=Person.KIND_USER, cluster_owner=owner
                )
                for index in range(people)
            ]
        )
    )
    rng = random.Random(3071)
    weights = list(accumulate(1.0 / (rank + 1) for rank in range(people)))
    Face.objects.bulk_create(  # raw-create: thousands of rows for the planner
        [
            Face(
                photo=photos[rng.randrange(len(photos))],
                person=rng.choices(persons, cum_weights=weights)[0],
                location_top=0,
                location_bottom=100,
                location_left=0,
                location_right=100,
                encoding="00",
            )
            for _ in range(faces)
        ],
        batch_size=500,
    )
    return persons


def analyzed_tables() -> set[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'"
        )
        if not cursor.fetchone()[0]:
            return set()
        cursor.execute("SELECT DISTINCT tbl FROM sqlite_stat1")
        return {row[0] for row in cursor.fetchall()}


class _CapturedError(Exception):
    pass


def face_count_plan(person: Person) -> list[str]:
    captured: list[tuple[str, Any]] = []

    def capture(execute: Any, sql: str, params: Any, many: bool, context: Any) -> Any:
        if not sql.startswith("SELECT COUNT(*)"):
            return execute(sql, params, many, context)
        captured.append((sql, params))
        raise _CapturedError

    with connection.execute_wrapper(capture), mock.patch.object(Person, "save"):
        try:
            person._calculate_face_count()
        except _CapturedError:
            pass
    sql, params = captured[0]
    with connection.cursor() as cursor:
        cursor.execute("EXPLAIN QUERY PLAN " + sql, params)
        return [row[-1] for row in cursor.fetchall()]


class StaleShareTest(TestCase):
    def test_a_table_is_stale_once_enough_of_it_changed(self):
        cases = [
            (None, 0, False),
            (None, planner_stats.MIN_CHANGED_ROWS - 1, False),
            (None, planner_stats.MIN_CHANGED_ROWS, True),
            (1000, 1000 + planner_stats.MIN_CHANGED_ROWS - 1, False),
            (10_000, 10_999, False),
            (10_000, 11_000, True),
            (10_000, 9_000, True),
            (10_000, 0, True),
        ]
        for analyzed, rows, stale in cases:
            with self.subTest(analyzed=analyzed, rows=rows):
                self.assertIs(stale, planner_stats.is_stale(analyzed, rows))

    def test_the_tables_that_grow_with_the_library_are_watched(self):
        tables = planner_stats.watched_tables()
        for table in (
            "api_photo",
            "api_photo_files",
            "api_thumbnail",
            "api_face",
            "api_person",
            "api_albumuser_photos",
            "api_albumthing_photos",
            "api_albumplace_photos",
            "api_albumauto_photos",
        ):
            self.assertIn(table, tables)


@unittest.skipUnless(ON_SQLITE, "SQLite planner statistics")
class RefreshPlannerStatsTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()

    def test_a_small_library_is_left_without_statistics(self):
        add_photos(self.owner, 10)

        self.assertEqual([], planner_stats.refresh_planner_stats())
        self.assertNotIn("api_photo", analyzed_tables())

    def test_photos_without_statistics_get_them(self):
        add_photos(self.owner, planner_stats.MIN_CHANGED_ROWS + 100)

        refreshed = planner_stats.refresh_planner_stats()

        self.assertIn(
            planner_stats.StaleTable(
                "api_photo", None, planner_stats.MIN_CHANGED_ROWS + 100
            ),
            refreshed,
        )
        self.assertIn("api_photo", analyzed_tables())
        self.assertIn("api_thumbnail", analyzed_tables())

    def test_a_few_more_photos_keep_the_statistics(self):
        add_photos(self.owner, 600)
        planner_stats.refresh_planner_stats()
        add_photos(self.owner, 50)

        self.assertEqual([], planner_stats.stale_tables())

    def test_many_more_photos_refresh_them(self):
        add_photos(self.owner, 600)
        planner_stats.refresh_planner_stats()
        add_photos(self.owner, planner_stats.MIN_CHANGED_ROWS)

        self.assertIn(
            planner_stats.StaleTable(
                "api_photo", 600, 600 + planner_stats.MIN_CHANGED_ROWS
            ),
            planner_stats.refresh_planner_stats(),
        )
        self.assertEqual([], planner_stats.stale_tables())

    def test_reload_reads_the_statistics_again_when_none_are_stale(self):
        add_photos(self.owner, 600)
        planner_stats.refresh_planner_stats()

        with CaptureQueriesContext(connection) as queries:
            self.assertEqual([], planner_stats.refresh_planner_stats(reload=True))

        statements = [query["sql"] for query in queries.captured_queries]
        self.assertIn("ANALYZE sqlite_schema", statements)
        self.assertNotIn("ANALYZE", statements)

    def test_without_statistics_there_is_nothing_to_reload(self):
        with CaptureQueriesContext(connection) as queries:
            planner_stats.refresh_planner_stats(reload=True)

        statements = [query["sql"] for query in queries.captured_queries]
        self.assertNotIn("ANALYZE sqlite_schema", statements)

    def test_a_database_error_is_logged_and_the_job_goes_on(self):
        with (
            mock.patch.object(
                planner_stats, "stale_tables", side_effect=DatabaseError("locked")
            ),
            self.assertLogs(planner_stats.logger, "WARNING"),
        ):
            self.assertEqual([], planner_stats.refresh_planner_stats())

    def test_the_face_count_starts_from_the_persons_faces_once_analyzed(self):
        photos = add_photos(self.owner, 2000)
        persons = add_faces(self.owner, photos, people=50, faces=3000)

        planner_stats.refresh_planner_stats()

        plan = face_count_plan(persons[0])
        self.assertIn("api_face", plan[0])
        self.assertIn("person_id", plan[0])


class OtherDatabasesTest(TestCase):
    def test_a_database_other_than_sqlite_is_left_alone(self):
        with (
            mock.patch.object(connection, "vendor", "postgresql"),
            self.assertNumQueries(0),
        ):
            self.assertEqual([], planner_stats.refresh_planner_stats(reload=True))
            self.assertEqual([], planner_stats.stale_tables())


class RefreshHooksTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_migrate_refreshes_the_statistics(self):
        config = apps.get_app_config("api")
        with mock.patch.object(planner_stats, "refresh_planner_stats") as refresh:
            post_migrate.send(
                sender=config,
                app_config=config,
                verbosity=0,
                interactive=False,
                using="default",
                apps=apps,
                plan=[],
            )

        refresh.assert_called_once_with("default")

    def test_a_job_that_reaches_its_target_refreshes_them_once(self):
        job = create_test_job(
            self.user, sealed=True, progress_current=3, progress_target=3
        )
        with mock.patch.object(job_utils, "refresh_planner_stats") as refresh:
            self.assertTrue(job_utils.finish_job_if_complete(job.job_id))
            self.assertFalse(job_utils.finish_job_if_complete(job.job_id))

        refresh.assert_called_once_with()

    def test_a_job_short_of_its_target_does_not(self):
        job = create_test_job(
            self.user, sealed=True, progress_current=2, progress_target=3
        )
        with mock.patch.object(job_utils, "refresh_planner_stats") as refresh:
            self.assertFalse(job_utils.finish_job_if_complete(job.job_id))

        refresh.assert_not_called()

    def test_scan_faces_reads_fresh_statistics_before_it_starts(self):
        job = create_test_job(self.user, job_type=LongRunningJob.JOB_SCAN_FACES)
        with (
            mock.patch.object(processing_jobs, "refresh_planner_stats") as refresh,
            mock.patch.object(processing_jobs.photo_faces, "restore_missing_crops"),
        ):
            processing_jobs.scan_faces(self.user, job.job_id)

        self.assertEqual(mock.call(reload=True), refresh.call_args_list[0])
