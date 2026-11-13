"""The scrubber (#2938): what a saved error report keeps, and what it never does.

The payloads are shaped like the ones sentry-sdk 2 (Django) and
@sentry/react 11 build, with every field that could carry a name, a path, an
address or a credential filled in.
"""

import copy
import json
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings

from api.error_reports import scrub
from api.error_reports.scrub import (
    SOURCE_BROWSER,
    SOURCE_SERVER,
    Json,
    JsonObject,
    ScrubContext,
    fingerprint,
    scrub_context,
    scrub_event,
    scrub_text,
    title,
)
from api.tests.utils import (
    create_test_album_user,
    create_test_library_folder,
    create_test_person,
    create_test_tag,
    create_test_user,
)


def dig(value: Json, *path: str | int) -> Json:
    """The value at ``path`` inside nested JSON; fails the test when it is not there."""
    for key in path:
        if isinstance(key, int):
            assert isinstance(value, list), path
            value = value[key]
        else:
            assert isinstance(value, dict), path
            value = value[key]
    return value


def text_at(value: Json, *path: str | int) -> str:
    found = dig(value, *path)
    assert isinstance(found, str), path
    return found


CONTEXT = ScrubContext(
    library_roots=("/data/photos", "D:\\Bilder"),
    code_roots=(
        ("/code", ""),
        ("/usr/local/lib/python3.14/site-packages", "site-packages/"),
        ("/usr/local/lib/python3.14", "python/"),
    ),
    private_roots=("C:\\Users\\gretchen",),
    hostnames=("photos.example.org", "photos-nas", "localhost"),
    names=("gretchen", "Gretchen", "Schmidt", "Hochzeit Anna & Ben", "Anna", "Ben"),
    release="2026w44",
)

DJANGO_EVENT: JsonObject = {
    "event_id": "9f2c3c1e4b0a4d6f8e7d6c5b4a392817",
    "timestamp": "2026-11-08T10:15:02.123456Z",
    "platform": "python",
    "level": "error",
    "server_name": "photos-nas",
    "release": "2026w44",
    "environment": "production",
    "transaction": "/api/albums/user/{album_id}/photos/add/",
    "transaction_info": {"source": "route"},
    "exception": {
        "values": [
            {
                "type": "FileNotFoundError",
                "value": "[Errno 2] No such file or directory: "
                "'/data/photos/gretchen/Hochzeit Anna & Ben/IMG_2041.HEIC'",
                "module": None,
                "mechanism": {"type": "django", "handled": False},
                "stacktrace": {
                    "frames": [
                        {
                            "filename": "django/core/handlers/exception.py",
                            "abs_path": "/usr/local/lib/python3.14/site-packages/"
                            "django/core/handlers/exception.py",
                            "function": "inner",
                            "module": "django.core.handlers.exception",
                            "lineno": 55,
                            "pre_context": ["    def inner(request):", "        try:"],
                            "context_line": "            response = get_response(request)",
                            "post_context": ["        except Exception as exc:"],
                            "in_app": False,
                            "vars": {
                                "request": "<WSGIRequest: POST '/api/albums/user/12/'>"
                            },
                        },
                        {
                            "filename": "api/photos/files.py",
                            "abs_path": "/code/api/photos/files.py",
                            "function": "open_original",
                            "module": "api.photos.files",
                            "lineno": 88,
                            "context_line": "    with open(path, 'rb') as f:",
                            "in_app": True,
                            "vars": {
                                "path": "'/data/photos/gretchen/IMG_2041.HEIC'",
                                "user": "<User: gretchen>",
                            },
                        },
                    ]
                },
            }
        ]
    },
    "request": {
        "url": "https://photos.example.org/api/albums/user/12/photos/add/",
        "method": "POST",
        "query_string": "token=abc123",
        "headers": {
            "Cookie": "jwt=eyJhbGciOiJIUzI1NiJ9.secret; csrftoken=cs3cr3t",
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
            "Host": "photos.example.org",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/144.0",
            "X-Forwarded-For": "203.0.113.7",
        },
        "cookies": {"jwt": "eyJhbGciOiJIUzI1NiJ9.secret"},
        "data": {"title": "Hochzeit Anna & Ben", "photo_ids": ["a1", "b2"]},
        "env": {"SERVER_NAME": "photos-nas", "REMOTE_ADDR": "203.0.113.7"},
    },
    "user": {
        "id": "3",
        "username": "gretchen",
        "email": "gretchen@example.org",
        "ip_address": "203.0.113.7",
    },
    "breadcrumbs": {
        "values": [
            {"category": "query", "message": "SELECT * FROM api_user WHERE 'gretchen'"}
        ]
    },
    "contexts": {
        "runtime": {"name": "CPython", "version": "3.14.0", "build": "3.14.0 (main)"},
        "trace": {"trace_id": "5f3e0c0d9a8b7c6d", "span_id": "a1b2c3d4"},
    },
    "extra": {"sys.argv": ["/code/manage.py", "qcluster"]},
    "modules": {"django": "6.1.3"},
    "tags": {"user": "gretchen"},
    "sdk": {
        "name": "sentry.python.django",
        "version": "2.73.0",
        "packages": [{"name": "pypi:sentry-sdk", "version": "2.73.0"}],
    },
}

DJANGO_Q_LOG_EVENT: JsonObject = {
    "event_id": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "level": "error",
    "logger": "django-q",
    "platform": "python",
    "logentry": {
        "message": "Failed '%(info_name)s' (%(task_name)s) - %(task_result)s",
        "params": {"info_name": "api.faces.train", "task_result": "gretchen"},
        "formatted": "Failed 'api.faces.train.train_faces' (alpha-bravo) - "
        "[Errno 13] Permission denied: 'D:\\Bilder\\Anna\\DSC_0001.NEF' : "
        "Traceback (most recent call last):\n"
        '  File "/code/api/faces/train.py", line 10, in train_faces\n'
        "PermissionError: mail gretchen@example.org from 192.168.1.20",
    },
    "contexts": {"runtime": {"name": "CPython", "version": "3.14.0"}},
}

BROWSER_EVENT: JsonObject = {
    "event_id": "1b2c3d4e5f60718293a4b5c6d7e8f901",
    "timestamp": 1762600000.123,
    "platform": "javascript",
    "level": "error",
    "environment": "production",
    "release": "frontend-local",
    "exception": {
        "values": [
            {
                "type": "TypeError",
                "value": "Cannot read properties of undefined (reading 'Anna')",
                "mechanism": {"type": "onerror", "handled": False},
                "stacktrace": {
                    "frames": [
                        {
                            "filename": "https://photos.example.org/assets/index-BfX2a9.js?v=3",
                            "function": "PersonCard",
                            "in_app": True,
                            "lineno": 12,
                            "colno": 3456,
                        }
                    ]
                },
            }
        ]
    },
    "request": {
        "url": "https://photos.example.org/person/42?name=Aunt%20Hildegard",
        "headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0",
            "Referer": "https://photos.example.org/search?q=Hildegard",
        },
    },
    "breadcrumbs": [
        {"category": "navigation", "data": {"from": "/search?q=Hildegard"}}
    ],
    "user": {"ip_address": "{{auto}}"},
    "contexts": {"trace": {"trace_id": "abc"}},
    "debug_meta": {
        "images": [{"code_file": "https://photos.example.org/assets/index.js"}]
    },
    "sdk": {"name": "sentry.javascript.react", "version": "11.9.0"},
}

NEVER_KEPT = (
    "gretchen",
    "Gretchen",
    "Anna",
    "Hildegard",
    "IMG_2041",
    "DSC_0001",
    "/data/photos",
    "Bilder",
    "photos.example.org",
    "photos-nas",
    "203.0.113.7",
    "192.168.1.20",
    "eyJ",
    "cs3cr3t",
    "Bearer",
    "token=abc123",
    "sys.argv",
    "trace_id",
    "{{auto}}",
    "Referer",
    "breadcrumbs",
    "photo_ids",
)


class ScrubEventTest(SimpleTestCase):
    def assert_private_gone(self, scrubbed: JsonObject) -> None:
        stored = json.dumps(scrubbed)
        for private in NEVER_KEPT:
            self.assertNotIn(private, stored)

    def test_a_django_request_error_keeps_the_stack_and_nothing_private(self) -> None:
        scrubbed = scrub_event(DJANGO_EVENT, CONTEXT, source=SOURCE_SERVER)

        self.assert_private_gone(scrubbed)
        self.assertEqual(
            set(scrubbed),
            {
                "event_id",
                "timestamp",
                "platform",
                "level",
                "release",
                "environment",
                "transaction",
                "exception",
                "request",
                "contexts",
                "sdk",
                "tags",
            },
        )
        self.assertEqual(scrubbed["request"], {"method": "POST"})
        self.assertEqual(
            scrubbed["transaction"], "/api/albums/user/{album_id}/photos/add/"
        )
        self.assertEqual(scrubbed["tags"], {"source": "server"})
        self.assertEqual(
            scrubbed["contexts"], {"runtime": {"name": "CPython", "version": "3.14.0"}}
        )
        self.assertEqual(
            scrubbed["sdk"], {"name": "sentry.python.django", "version": "2.73.0"}
        )
        exception = dig(scrubbed, "exception", "values", 0)
        self.assertEqual(text_at(exception, "type"), "FileNotFoundError")
        self.assertEqual(
            text_at(exception, "value"),
            "[Errno 2] No such file or directory: '<library>'",
        )
        library_frame = dig(exception, "stacktrace", "frames", 0)
        app_frame = dig(exception, "stacktrace", "frames", 1)
        self.assertEqual(
            text_at(library_frame, "abs_path"),
            "site-packages/django/core/handlers/exception.py",
        )
        self.assertEqual(text_at(library_frame, "pre_context", 1), "        try:")
        self.assertNotIn("vars", json.dumps(library_frame))
        self.assertEqual(text_at(app_frame, "abs_path"), "api/photos/files.py")
        self.assertEqual(text_at(app_frame, "function"), "open_original")
        self.assertEqual(dig(app_frame, "lineno"), 88)
        self.assertIs(dig(app_frame, "in_app"), True)

    def test_a_django_q_failure_keeps_its_traceback_text_scrubbed(self) -> None:
        scrubbed = scrub_event(DJANGO_Q_LOG_EVENT, CONTEXT, source=SOURCE_SERVER)

        self.assert_private_gone(scrubbed)
        self.assertNotIn("params", json.dumps(dig(scrubbed, "logentry")))
        formatted = text_at(scrubbed, "logentry", "formatted")
        self.assertIn("Permission denied: '<library>'", formatted)
        self.assertIn('File "api/faces/train.py", line 10, in train_faces', formatted)
        self.assertIn("<email>", formatted)
        self.assertIn("<ip>", formatted)
        self.assertEqual(scrubbed["logger"], "django-q")

    def test_a_browser_error_keeps_the_script_path_and_the_user_agent(self) -> None:
        scrubbed = scrub_event(BROWSER_EVENT, CONTEXT, source=SOURCE_BROWSER)

        self.assert_private_gone(scrubbed)
        self.assertNotIn("debug_meta", scrubbed)
        self.assertNotIn("user", scrubbed)
        self.assertEqual(scrubbed["release"], "2026w44")
        self.assertEqual(
            scrubbed["request"],
            {"headers": {"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0"}},
        )
        frame = dig(scrubbed, "exception", "values", 0, "stacktrace", "frames", 0)
        self.assertEqual(text_at(frame, "filename"), "/assets/index-BfX2a9.js")
        self.assertEqual(dig(frame, "colno"), 3456)
        self.assertEqual(scrubbed["tags"], {"source": "browser"})

    def test_an_unknown_field_never_gets_through(self) -> None:
        event = copy.deepcopy(BROWSER_EVENT)
        event["new_sdk_field"] = {"photo": "Anna"}
        self.assertNotIn(
            "new_sdk_field", scrub_event(event, CONTEXT, source=SOURCE_BROWSER)
        )

    def test_the_title_and_fingerprint_survive_a_changed_message(self) -> None:
        first = scrub_event(DJANGO_EVENT, CONTEXT, source=SOURCE_SERVER)
        other = copy.deepcopy(DJANGO_EVENT)
        value = dig(other, "exception", "values", 0)
        assert isinstance(value, dict)
        value["value"] = "another file"
        second = scrub_event(other, CONTEXT, source=SOURCE_SERVER)

        self.assertEqual(
            title(first),
            "FileNotFoundError: [Errno 2] No such file or directory: '<library>'",
        )
        self.assertEqual(fingerprint(first), fingerprint(second))
        browser = scrub_event(BROWSER_EVENT, CONTEXT, source=SOURCE_BROWSER)
        self.assertNotEqual(fingerprint(first), fingerprint(browser))


class ScrubTextTest(SimpleTestCase):
    def test_patterns(self) -> None:
        cases = {
            "mail gretchen@example.org now": "mail <email> now",
            "from 10.0.0.12:8001": "from <ip>:8001",
            "peer 2001:db8::1 closed": "peer <ip> closed",
            "at 12:30:45 sharp": "at 12:30:45 sharp",
            "GET https://cdn.example.net/x?y=1 failed": "GET <url> failed",
            "opened IMG_0001.JPG twice": "opened <file> twice",
            "saw /mnt/usb/backup/a.txt": "saw <path>",
            "saw E:\\Fotos\\2024\\a.txt": "saw <path>",
            "module api.views.photos failed": "module api.views.photos failed",
            "host photos-nas is down": "host <host> is down",
            "host localhost is up": "host localhost is up",
            "Album 'Hochzeit Anna & Ben' exists": "Album '<name>' exists",
            "user GRETCHEN signed in": "user <name> signed in",
            "a Benchmark ran": "a Benchmark ran",
        }
        for text, scrubbed in cases.items():
            with self.subTest(text=text):
                self.assertEqual(scrub_text(text, CONTEXT), scrubbed)

    def test_a_home_folder_and_a_windows_code_path(self) -> None:
        context = ScrubContext(
            code_roots=(("C:\\Program Files\\LibrePhotos\\app", ""),),
            private_roots=("C:\\Users\\gretchen",),
        )
        self.assertEqual(
            scrub_text(
                'File "C:\\Program Files\\LibrePhotos\\app\\api\\x.py", line 3', context
            ),
            'File "api\\x.py", line 3',
        )
        self.assertEqual(
            scrub_text("cannot open 'C:\\Users\\gretchen\\Pictures\\a b'", context),
            "cannot open '<path>'",
        )

    def test_long_text_is_cut(self) -> None:
        self.assertEqual(len(scrub_text("x" * 5000, CONTEXT)), 2000)


# Tags come from the keywords in files, and some are everyday words or
# numbers. In 1.6.0 they turned "POST" into "<name>", "Could not" into "Could
# <name>", "500 Server Error" into "<name> Server Error", line numbers into
# "line <name>" and api/search/ into api/<name>/.
WORDS_AS_NAMES = ScrubContext(
    names=("Gretchen", "POST", "not", "from", "500", "102", "185", "search", "post")
)


class ScrubCommonWordsTest(SimpleTestCase):
    def test_everyday_words_numbers_and_code_in_text_stay(self) -> None:
        kept = (
            "Could not create thumbnail for file <library>",
            "Error while parsing datetime from '2035:09:19 05:37:53+02:00'",
            "HTTPError: 500 Server Error: INTERNAL SERVER ERROR for url: <url>",
            "OSError: image file is truncated (462 bytes not processed)",
            "POST to the exif sidecar failed",
            'File "site-packages/django_q/worker.py", line 102, in worker',
            'File "api/search/semantic.py", line 165, in generate_photo_tags',
            "Function api.search.semantic.generate_photo_tags is not defined",
            "Error: Minified React error #185; visit <url> for the full message",
        )
        for text in kept:
            with self.subTest(text=text):
                self.assertEqual(scrub_text(text, WORDS_AS_NAMES), text)

    def test_a_name_is_still_scrubbed(self) -> None:
        self.assertEqual(
            scrub_text("no face of Gretchen in photos tagged search", WORDS_AS_NAMES),
            "no face of <name> in photos tagged <name>",
        )

    def test_code_in_a_stack_frame_keeps_its_names(self) -> None:
        event: JsonObject = {
            "logger": "api.search.semantic",
            "exception": {
                "values": [
                    {
                        "type": "ReadTimeout",
                        "module": "requests.exceptions",
                        "stacktrace": {
                            "frames": [
                                {
                                    "filename": "api/search/semantic.py",
                                    "abs_path": "/code/api/search/semantic.py",
                                    "module": "api.search.semantic",
                                    "function": "post",
                                    "lineno": 165,
                                    "context_line": "response = sidecars.post(",
                                }
                            ]
                        },
                    }
                ]
            },
        }
        context = ScrubContext(code_roots=(("/code", ""),), names=WORDS_AS_NAMES.names)

        scrubbed = scrub_event(event, context, source=SOURCE_SERVER)

        self.assertEqual(scrubbed["logger"], "api.search.semantic")
        frame = dig(scrubbed, "exception", "values", 0, "stacktrace", "frames", 0)
        self.assertEqual(text_at(frame, "filename"), "api/search/semantic.py")
        self.assertEqual(text_at(frame, "abs_path"), "api/search/semantic.py")
        self.assertEqual(text_at(frame, "module"), "api.search.semantic")
        self.assertEqual(text_at(frame, "function"), "post")
        self.assertEqual(text_at(frame, "context_line"), "response = sidecars.post(")


@override_settings(DATA_ROOT="/data/photos")
class ScrubContextTest(TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.dict(scrub._cache, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_it_knows_the_instance_private_names_and_folders(self) -> None:
        user = create_test_user(username="gretchen", first_name="Gretchen")
        create_test_person(name="Aunt Hildegard", cluster_owner=user)
        create_test_album_user(owner=user, title="Sommer am See")
        create_test_tag(owner=user, name="Familienfeier")
        folder = create_test_library_folder(user, "/mnt/archive")

        context = scrub_context()

        for name in ("gretchen", "Gretchen", "Aunt Hildegard", "Hildegard"):
            self.assertIn(name, context.names)
        self.assertIn("Sommer am See", context.names)
        self.assertIn("Familienfeier", context.names)
        self.assertIn("/data/photos", context.library_roots)
        self.assertIn(folder.path, context.library_roots)
        self.assertEqual(
            scrub_text(f"cannot read {folder.path}/x/y.txt", context),
            "cannot read <library>",
        )
