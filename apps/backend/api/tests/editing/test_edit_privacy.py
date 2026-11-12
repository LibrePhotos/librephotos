"""Who gets which picture of an edited photo from ``/media/photos/<image_hash>``.

Only the photo's owner ever gets the unedited original of an edited photo,
and only with ``?original=1``. Everyone else, in every state of the edit,
gets the edited picture: the rendition when it is ready, else the save's
render; a share's metadata-free copy is made from the same. A recipe that
changes nothing has nothing to hide.

The picture is 120 x 80 and the edit crops it to 60 x 40, so the size of
what is served says which it is.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from typing import Any
from unittest import mock

import PIL.Image
from django.test import override_settings
from rest_framework.test import APIClient

from api.editing import files, renditions
from api.models import User
from api.models.album_user_share import AlbumUserShare
from api.models.user import get_default_public_sharing_settings
from api.tests.editing.edited_photo import (
    CROP,
    HEIGHT,
    WIDTH,
    EditedPhotoTestCase,
    recipe,
)
from api.tests.utils import (
    create_test_album_user,
    create_test_library_share,
    create_test_user,
)

ORIGINAL = (WIDTH, HEIGHT)
EDITED = (60, 40)
ALL_PUBLIC_SWITCHES = dict.fromkeys(get_default_public_sharing_settings(), True)


def _size(response: Any) -> tuple[int, int]:
    content = (
        b"".join(response.streaming_content) if response.streaming else response.content
    )
    if hasattr(response, "close"):
        response.close()
    with PIL.Image.open(io.BytesIO(content)) as image:
        return image.size


@override_settings(SERVE_FRONTEND=True)
class EditedPhotoAudienceTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.media_url = f"/media/photos/{self.photo.image_hash}"

    # --- Audiences ---------------------------------------------------------------

    def _client(self, user: User | None) -> APIClient:
        client = APIClient()
        if user is not None:
            client.force_authenticate(user=user)
        return client

    def owner_client(self) -> APIClient:
        return self._client(self.owner)

    def direct_share(self) -> APIClient:
        recipient = create_test_user()
        self.photo.shared_to.add(recipient)
        return self._client(recipient)

    def album_member(self) -> APIClient:
        member = create_test_user()
        album = create_test_album_user(owner=self.owner)
        album.photos.add(self.photo)
        album.shared_to.add(member)
        return self._client(member)

    def library_share(self) -> APIClient:
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient)
        return self._client(recipient)

    def library_share_with_originals(self) -> APIClient:
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient, share_originals=True)
        return self._client(recipient)

    def _public_album(self) -> None:
        album = create_test_album_user(owner=self.owner)
        album.photos.add(self.photo)
        AlbumUserShare.objects.create(album=album, enabled=True)

    def public_link(self) -> APIClient:
        self._public_album()
        return self._client(None)

    def public_link_with_originals(self) -> APIClient:
        self.owner.public_sharing_defaults = ALL_PUBLIC_SWITCHES
        self.owner.save()
        self._public_album()
        return self._client(None)

    def audiences(self) -> dict[str, Callable[[], APIClient]]:
        return {
            "direct share": self.direct_share,
            "album member": self.album_member,
            "library share": self.library_share,
            "library share with originals": self.library_share_with_originals,
            "public link": self.public_link,
            "public link with originals": self.public_link_with_originals,
        }

    # --- States -----------------------------------------------------------------

    def ready(self) -> None:
        self.save(CROP)
        self.run_queued()

    def pending(self) -> None:
        self.save(CROP)

    def failed(self) -> None:
        self.save(CROP)
        failing = mock.patch.object(
            renditions, "_render_full", side_effect=renditions.RenderError("x")
        )
        with failing:
            self.run_queued()

    def identity(self) -> None:
        self.ready()
        history = [
            {"action": "crop", "at": "2026-11-12T09:30:00Z", "settings": CROP},
            {"action": "reset", "at": "2026-11-12T09:31:00Z", "settings": recipe()},
        ]
        self.save(recipe(), history=history)

    def check(self, state: Callable[[], None], expected: tuple[int, int]) -> None:
        clients = {name: make() for name, make in self.audiences().items()}
        state()
        for name, client in clients.items():
            for query in ("", "?original=1"):
                with self.subTest(audience=name, query=query):
                    response = client.get(self.media_url + query)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(_size(response), expected)

    def check_owner(self, state: Callable[[], None], edited: bool) -> None:
        client = self.owner_client()
        state()
        self.assertEqual(
            _size(client.get(self.media_url)), EDITED if edited else ORIGINAL
        )
        self.assertEqual(_size(client.get(self.media_url + "?original=1")), ORIGINAL)

    # --- The matrix ---------------------------------------------------------------

    def test_ready_everyone_else_gets_the_edit(self):
        self.check(self.ready, EDITED)

    def test_pending_everyone_else_gets_the_edit(self):
        self.check(self.pending, EDITED)

    def test_failed_everyone_else_gets_the_edit(self):
        self.check(self.failed, EDITED)

    def test_identity_everyone_gets_the_original(self):
        self.check(self.identity, ORIGINAL)

    def test_the_owner_gets_the_original_only_by_asking(self):
        for name, state in (
            ("ready", self.ready),
            ("pending", self.pending),
            ("failed", self.failed),
        ):
            with self.subTest(state=name):
                self.check_owner(state, edited=True)

    def test_the_owner_of_an_identity_edit_gets_the_original(self):
        self.check_owner(self.identity, edited=False)

    def test_original_from_someone_else_is_not_an_error(self):
        client = self.direct_share()
        self.pending()
        plain = client.get(self.media_url)
        asked = client.get(self.media_url + "?original=1")
        self.assertEqual(
            (plain.status_code, plain["Content-Type"]),
            (asked.status_code, asked["Content-Type"]),
        )
        self.assertEqual(_size(plain), _size(asked))

    def test_an_edit_without_any_file_is_never_the_original(self):
        client = self.direct_share()
        self.pending()
        with mock.patch.object(renditions, "restore_preview", return_value=False):
            files.remove_edit_files(self.photo.image_hash)
            response = client.get(self.media_url)
        self.assertEqual(response.status_code, 404)


@override_settings(SERVE_FRONTEND=True)
class NoMomentShowsTheOriginalTest(EditedPhotoTestCase):
    """Between a save's commit and its callbacks, and after each of them."""

    def setUp(self) -> None:
        super().setUp()
        recipient = create_test_user()
        self.photo.shared_to.add(recipient)
        self.recipient = APIClient()
        self.recipient.force_authenticate(user=recipient)
        self.media_url = f"/media/photos/{self.photo.image_hash}"

    def assert_edited(self) -> None:
        self.assertEqual(_size(self.recipient.get(self.media_url)), EDITED)

    def _save_step_by_step(self) -> None:
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            response = self.client.put(
                self.url(),
                {
                    "settings": CROP,
                    "history": [
                        {
                            "action": "crop",
                            "at": "2026-11-12T09:30:00Z",
                            "settings": CROP,
                        }
                    ],
                    "history_cursor": 0,
                },
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        # Committed, nothing after the commit has run yet.
        self.assert_edited()
        for callback in callbacks:
            callback()
            self.assert_edited()

    def test_a_first_save(self):
        self._save_step_by_step()

    def test_a_save_over_a_ready_rendition(self):
        self.save(CROP)
        self.run_queued()
        self._save_step_by_step()

    def test_the_render_task_step_by_step(self):
        self.save(CROP)
        (task,) = self.queued
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            renditions.render_rendition(*task)
        self.assert_edited()
        for callback in callbacks:
            callback()
            self.assert_edited()

    @override_settings(SERVE_FRONTEND=False)
    def test_behind_the_proxy_the_save_render_is_handed_out(self):
        self.save(CROP)
        response = self.recipient.get(self.media_url + "?original=1")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/{files.EDITS_DIR}/{self.photo.image_hash}"
            f"{files.PREVIEW_SUFFIX}",
        )
