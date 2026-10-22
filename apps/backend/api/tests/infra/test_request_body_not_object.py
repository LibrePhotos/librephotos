"""A request body that is not a JSON object answers 400, not 500.

``request.data`` is a list (or a string, a number, ...) when the JSON body is
not an object. The views below called ``.get`` on it, or ``dict()`` on it, or
asserted it was a dict, so a body of ``[]`` crashed them. They now read the
body through ``api.drf.request_data.request_dict``, which raises ``ParseError``;
the project's exception handler turns that into the usual error envelope.
"""

from django.http import QueryDict
from django.test import TestCase
from rest_framework.exceptions import ParseError
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

from api.drf.request_data import request_dict
from api.models import Tag
from api.tests.utils import create_test_tag, create_test_user

EXPECTED = {
    "errors": [
        {
            "field": "detail",
            "message": "Expected a JSON object as the request body.",
            "code": "parse_error",
        }
    ]
}

# (method, url) per view; at least one per view module that reads the body.
USER_ENDPOINTS = [
    # faces.py
    ("post", "/api/labelfaces"),
    ("post", "/api/deletefaces"),
    ("post", "/api/restore-faces/"),
    ("post", "/api/restore-face-labels/"),
    ("post", "/api/addface"),
    # scan_triggers.py
    ("post", "/api/generateocr"),
    ("post", "/api/generate-captions/"),
    # processing_status.py
    ("post", "/api/library/processing-status/run/"),
    # stacks.py
    ("post", "/api/stacks/manual/"),
    ("post", "/api/stacks/detect/"),
    # duplicates.py
    ("post", "/api/duplicates/detect"),
    # tags.py
    ("post", "/api/tags/"),
    # zip_downloads.py
    ("post", "/api/photos/download"),
    # public_photos.py
    ("post", "/api/photo/share/"),
    # photos.py
    ("post", "/api/photos/abc123/main-file"),
    ("post", "/api/photosedit/rotate"),
    ("post", "/api/savemetadata"),
    ("post", "/api/photosedit/share"),
    ("post", "/api/photosedit/savecaption"),
    ("post", "/api/photosedit/favorite"),
    ("delete", "/api/photosedit/delete"),
    # photo_metadata.py
    ("patch", "/api/photos/metadata/bulk"),
    # public_albums.py
    ("post", "/api/useralbum/makepublic"),
    # sharing.py
    ("post", "/api/useralbum/share"),
]

ADMIN_ENDPOINTS = [
    # email_config.py
    ("post", "/api/email-config/"),
    # site_settings.py
    ("post", "/api/sitesettings"),
]

ANONYMOUS_ENDPOINTS = [
    # password_reset.py
    ("post", "/api/auth/password/reset/"),
    ("post", "/api/auth/password/reset/confirm/"),
]


class RequestBodyNotObjectTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()

    def _assert_rejected(self, method, url, body):
        response = getattr(self.client, method)(url, data=body, format="json")
        self.assertEqual(response.status_code, 400, (method, url, body))
        self.assertEqual(response.json(), EXPECTED, (method, url, body))

    def test_user_endpoints_reject_a_json_array(self):
        self.client.force_authenticate(user=self.user)
        for method, url in USER_ENDPOINTS:
            for body in ([], [1, 2]):
                with self.subTest(method=method, url=url, body=body):
                    self._assert_rejected(method, url, body)

    def test_tag_actions_reject_a_json_array(self):
        self.client.force_authenticate(user=self.user)
        tag = create_test_tag(name="trip", owner=self.user)
        for action in ("add", "remove", "merge"):
            with self.subTest(action=action):
                self._assert_rejected("post", f"/api/tags/{tag.pk}/{action}/", [])

    def test_admin_endpoints_reject_a_json_array(self):
        self.client.force_authenticate(user=self.admin)
        for method, url in ADMIN_ENDPOINTS:
            with self.subTest(method=method, url=url):
                self._assert_rejected(method, url, [])

    def test_anonymous_endpoints_reject_a_json_array(self):
        for method, url in ANONYMOUS_ENDPOINTS:
            with self.subTest(method=method, url=url):
                self._assert_rejected(method, url, [])

    def test_scalar_bodies_are_rejected_too(self):
        self.client.force_authenticate(user=self.user)
        for body in ("text", 3, True):
            with self.subTest(body=body):
                self._assert_rejected("post", "/api/tags/", body)

    def test_form_bodies_still_work(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post("/api/tags/", data={"name": "beach"})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(Tag.objects.filter(name="beach", owner=self.user).exists())


class RequestDictTest(TestCase):
    def _request(self, factory_call):
        return APIView().initialize_request(factory_call)

    def test_json_object_is_returned(self):
        request = self._request(APIRequestFactory().post("/", {"a": 1}, format="json"))
        self.assertEqual(request_dict(request), {"a": 1})

    def test_empty_json_body_is_an_empty_object(self):
        request = self._request(
            APIRequestFactory().post("/", "", content_type="application/json")
        )
        self.assertEqual(request_dict(request), {})

    def test_form_body_is_the_query_dict(self):
        request = self._request(
            APIRequestFactory().post("/", {"a": ["1", "2"]}, format="multipart")
        )
        data = request_dict(request)
        self.assertIsInstance(data, QueryDict)
        self.assertEqual(data.getlist("a"), ["1", "2"])

    def test_json_array_raises_parse_error(self):
        request = self._request(APIRequestFactory().post("/", [1], format="json"))
        with self.assertRaises(ParseError):
            request_dict(request)
