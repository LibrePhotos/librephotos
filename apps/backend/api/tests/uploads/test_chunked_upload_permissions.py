"""Characterization tests for ``UploadPhotosChunkedComplete.check_permissions``.

The target is the permission gate of the chunked-upload *complete*
endpoint (``api/views/upload.py``)::

    def check_permissions(self, request):
        if not site_config.ALLOW_UPLOAD:
            raise _forbidden("Uploading is not allowed")
        authenticate_upload_request(request)

Almost all of its cyclomatic complexity lives in the helper
``authenticate_upload_request`` (cookie present? token parseable? user row
found?), so these tests exercise the gate end-to-end through the view method
and additionally pin the helper directly, because a refactor is likely to move
code across that seam.

Everything asserted here is *observed current behaviour*, including the quirks
flagged as "Quirk"/"Pinned bug" below. Nothing heavy is imported: no ML models,
no network, no exiftool.
"""

import datetime
from unittest.mock import patch

from chunked_upload.exceptions import ChunkedUploadError
from constance.test import override_config
from django.test import RequestFactory, TestCase
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from api.tests.utils import create_test_user
from api.views.upload import (
    UploadPhotosChunked,
    UploadPhotosChunkedComplete,
    _bad_request,
    _forbidden,
    authenticate_upload_request,
    validate_scan_directory,
)


def make_request(jwt=None):
    request = RequestFactory().post("/api/chunked_upload/complete/")
    if jwt is not None:
        request.COOKIES["jwt"] = jwt
    return request


def token_for(user):
    return str(AccessToken.for_user(user))


NOT_PROVIDED = "Authentication credentials were not provided"
INVALID = "Authentication credentials were invalid"


@override_config(ALLOW_UPLOAD=True)
class CheckPermissionsTest(TestCase):
    """Branch-by-branch behaviour of the complete-view permission gate."""

    def setUp(self):
        self.view = UploadPhotosChunkedComplete()
        self.user = create_test_user()

    # -- the ALLOW_UPLOAD branch -------------------------------------------

    @override_config(ALLOW_UPLOAD=False)
    def test_upload_disabled_raises_403_before_authentication(self):
        # No jwt cookie at all: proves the config check short-circuits first,
        # otherwise the detail would be the "not provided" message.
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request())

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual("Uploading is not allowed", ctx.exception.data["detail"])

    @override_config(ALLOW_UPLOAD=False)
    def test_upload_disabled_beats_a_perfectly_valid_token(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=token_for(self.user)))

        self.assertEqual("Uploading is not allowed", ctx.exception.data["detail"])

    @override_config(ALLOW_UPLOAD=False)
    def test_upload_disabled_does_not_touch_the_database(self):
        with patch("api.views.upload.authenticate_upload_request") as auth:
            with self.assertRaises(ChunkedUploadError):
                self.view.check_permissions(make_request(jwt=token_for(self.user)))
        auth.assert_not_called()

    # -- the missing-cookie branch -----------------------------------------

    def test_missing_jwt_cookie_raises_403_not_provided(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request())

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(NOT_PROVIDED, ctx.exception.data["detail"])

    def test_empty_jwt_cookie_is_treated_as_an_invalid_token(self):
        # Quirk: "" is not None, so it falls through to AccessToken("") and
        # reports "invalid" rather than "not provided".
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=""))

        self.assertEqual(INVALID, ctx.exception.data["detail"])

    # -- the unparseable-token branch --------------------------------------

    def test_garbage_token_raises_403_invalid(self):
        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt="not-a-real-token"))

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(INVALID, ctx.exception.data["detail"])

    def test_tampered_signature_raises_403_invalid(self):
        good = token_for(self.user)
        head, _, signature = good.rpartition(".")
        tampered = f"{head}.{'A' * len(signature)}"

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=tampered))

        self.assertEqual(INVALID, ctx.exception.data["detail"])

    def test_expired_token_raises_403_invalid(self):
        token = AccessToken.for_user(self.user)
        token.set_exp(lifetime=datetime.timedelta(seconds=-30))

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=str(token)))

        self.assertEqual(INVALID, ctx.exception.data["detail"])

    def test_refresh_token_is_rejected_as_invalid(self):
        # Wrong token_type claim -> TokenError -> "invalid".
        refresh = str(RefreshToken.for_user(self.user))

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=refresh))

        self.assertEqual(INVALID, ctx.exception.data["detail"])

    # -- the unknown-user branch -------------------------------------------

    def test_token_for_nonexistent_user_raises_403_not_provided(self):
        # Quirk: a syntactically valid token for a deleted user reports the
        # *same* message as a completely missing cookie.
        token = AccessToken.for_user(self.user)
        token["user_id"] = 99999999

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=str(token)))

        self.assertEqual(403, ctx.exception.status_code)
        self.assertEqual(NOT_PROVIDED, ctx.exception.data["detail"])

    def test_deleted_user_after_token_issue_raises_403_not_provided(self):
        jwt = token_for(self.user)
        self.user.delete()

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.view.check_permissions(make_request(jwt=jwt))

        self.assertEqual(NOT_PROVIDED, ctx.exception.data["detail"])

    # -- the happy path ----------------------------------------------------

    def test_valid_token_returns_none(self):
        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(self.user)))
        )

    def test_valid_token_does_not_attach_the_user_to_the_request(self):
        # The authenticated user is discarded here; on_completion re-runs the
        # authentication to get it back.
        request = make_request(jwt=token_for(self.user))
        self.view.check_permissions(request)

        self.assertFalse(hasattr(request, "user_from_upload"))
        self.assertNotIsInstance(getattr(request, "user", None), type(self.user))

    def test_inactive_user_is_still_allowed(self):
        # Pinned bug: the lookup is a bare ``User.objects.filter(id=...)`` with
        # no ``is_active`` check, so a deactivated account can still upload.
        self.user.is_active = False
        self.user.save()

        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(self.user)))
        )

    def test_scan_directory_is_not_validated_here(self):
        # Quirk: an unusable scan_directory only surfaces later, in
        # on_completion, after the whole file has been uploaded.
        self.user.scan_directory = ""
        self.user.save()

        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(self.user)))
        )

    def test_non_admin_ordinary_user_is_allowed(self):
        # No staff/superuser requirement: any account with a valid token passes.
        ordinary = create_test_user(is_admin=False)
        self.assertFalse(ordinary.is_staff)

        self.assertIsNone(
            self.view.check_permissions(make_request(jwt=token_for(ordinary)))
        )

    def test_any_authenticated_user_passes_regardless_of_upload_id(self):
        # check_permissions never looks at request.POST / the upload_id, so it
        # cannot tell whether the caller owns the ChunkedUpload row.
        request = RequestFactory().post(
            "/api/chunked_upload/complete/", {"upload_id": "someone-elses-id"}
        )
        request.COOKIES["jwt"] = token_for(create_test_user())

        self.assertIsNone(self.view.check_permissions(request))


@override_config(ALLOW_UPLOAD=True)
class CheckPermissionsMatchesChunkedViewTest(TestCase):
    """The two views carry a duplicated copy of the same gate."""

    def setUp(self):
        self.user = create_test_user()

    def _details(self, jwt):
        out = []
        for view in (UploadPhotosChunked(), UploadPhotosChunkedComplete()):
            try:
                out.append(view.check_permissions(make_request(jwt=jwt)))
            except ChunkedUploadError as exc:
                out.append((exc.status_code, exc.data["detail"]))
        return out

    def test_both_views_agree_on_every_outcome(self):
        for jwt in (None, "", "garbage", token_for(self.user)):
            with self.subTest(jwt=jwt):
                first, second = self._details(jwt)
                self.assertEqual(first, second)

    @override_config(ALLOW_UPLOAD=False)
    def test_both_views_agree_when_upload_is_disabled(self):
        first, second = self._details(token_for(self.user))
        self.assertEqual((403, "Uploading is not allowed"), first)
        self.assertEqual(first, second)


class AuthenticateUploadRequestTest(TestCase):
    """The helper the gate delegates to, pinned directly."""

    def setUp(self):
        self.user = create_test_user()

    def test_returns_the_user_object_on_success(self):
        returned = authenticate_upload_request(make_request(jwt=token_for(self.user)))

        self.assertEqual(self.user.pk, returned.pk)
        self.assertEqual(self.user.username, returned.username)

    def test_ignores_the_authorization_header(self):
        # Only the "jwt" cookie is consulted; a bearer header does not help.
        request = RequestFactory().post(
            "/api/chunked_upload/complete/",
            HTTP_AUTHORIZATION=f"Bearer {token_for(self.user)}",
        )

        with self.assertRaises(ChunkedUploadError) as ctx:
            authenticate_upload_request(request)

        self.assertEqual(NOT_PROVIDED, ctx.exception.data["detail"])

    def test_token_without_user_id_claim_raises_keyerror_not_403(self):
        # Pinned bug: a token missing the user_id claim escapes as a raw
        # KeyError, which the chunked-upload machinery turns into a 500 rather
        # than a 403.
        token = AccessToken.for_user(self.user)
        del token.payload["user_id"]

        with self.assertRaises(KeyError):
            authenticate_upload_request(make_request(jwt=str(token)))

    def test_only_tokenerror_is_converted_to_403(self):
        # Any other exception from AccessToken() propagates untouched.
        with patch("api.views.upload.AccessToken", side_effect=ValueError("boom")):
            with self.assertRaises(ValueError):
                authenticate_upload_request(make_request(jwt="whatever"))

        with patch("api.views.upload.AccessToken", side_effect=TokenError("nope")):
            with self.assertRaises(ChunkedUploadError) as ctx:
                authenticate_upload_request(make_request(jwt="whatever"))
        self.assertEqual(INVALID, ctx.exception.data["detail"])


class ErrorHelperTest(TestCase):
    """Shape of the exceptions the gate raises."""

    def test_forbidden_builds_a_403_chunked_upload_error(self):
        exc = _forbidden("nope")

        self.assertIsInstance(exc, ChunkedUploadError)
        self.assertEqual(403, exc.status_code)
        self.assertEqual({"detail": "nope"}, exc.data)

    def test_bad_request_builds_a_400_chunked_upload_error(self):
        exc = _bad_request("bad")

        self.assertIsInstance(exc, ChunkedUploadError)
        self.assertEqual(400, exc.status_code)
        self.assertEqual({"detail": "bad"}, exc.data)

    def test_validate_scan_directory_is_not_part_of_the_permission_gate(self):
        # Guards against a refactor that folds this check into
        # check_permissions: today it is only called from on_completion.
        user = create_test_user(scan_directory="")

        with self.assertRaises(ChunkedUploadError) as ctx:
            validate_scan_directory(user)

        self.assertEqual(400, ctx.exception.status_code)
        self.assertIn("No scan directory configured", ctx.exception.data["detail"])
