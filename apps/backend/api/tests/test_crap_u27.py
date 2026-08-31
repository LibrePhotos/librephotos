"""Characterization tests for the two high-CRAP ``update`` methods in
``api.serializers.user``.

Targets:
  * ``UserSerializer.update``        (complexity 38)
  * ``ManageUserSerializer.update``  (complexity 17)

Both are exercised by calling ``.update(instance, validated_data)`` directly on
a serializer instance -- no HTTP layer, no ML models, no network. The only
heavy collaborator is the django-q ``Chain`` used by the ``semantic_search_topk``
branch, which is patched at ``api.serializers.user``.

Quirks deliberately pinned (see inline comments):
  * ``UserSerializer.update`` mutates the ``validated_data`` dict it is given
    (every handled key is ``pop``-ed out).
  * A password-only update calls ``set_password`` but never calls
    ``instance.save()`` -- the new hash is NOT persisted by this method.
  * ``semantic_search_topk`` only kicks off the CLIP chain on the 0 -> positive
    transition; ``download_models`` is only chained when models are missing.
  * ``ManageUserSerializer.update`` accepts an empty username and assigns it
    without the uniqueness check; it also mutates the instance in memory before
    raising ``ValidationError``, but never saves in that case.
  * ``ManageUserSerializer.update`` silently ignores a falsy (empty) scan
    directory, and validates "inside DATA_ROOT" before "exists".
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from rest_framework.exceptions import ValidationError

from api.models import User
from api.serializers.user import ManageUserSerializer, UserSerializer
from api.tests.utils import create_test_user


class UserSerializerUpdateTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.serializer = UserSerializer()

    def _update(self, **data):
        return self.serializer.update(self.user, data)

    # ---- password branch ------------------------------------------------

    def test_password_is_hashed_but_not_persisted(self):
        """set_password is called, but this branch never saves the instance."""
        result = self._update(password="new-password-123")

        self.assertIs(result, self.user)
        self.assertTrue(self.user.check_password("new-password-123"))
        # BUG-ish, pinned as-is: no instance.save() in the password branch, so
        # the change is lost unless another branch saves.
        self.assertFalse(
            User.objects.get(id=self.user.id).check_password("new-password-123")
        )

    def test_empty_password_is_ignored(self):
        with patch.object(User, "set_password") as set_password:
            self._update(password="")
        set_password.assert_not_called()

    @override_settings(DEMO_SITE=True)
    def test_password_ignored_on_demo_site(self):
        with patch.object(User, "set_password") as set_password:
            self._update(password="whatever")
        set_password.assert_not_called()

    def test_password_followed_by_saving_field_persists_hash(self):
        """Another branch's save() is what actually persists the password."""
        self._update(password="pw-abc-123", first_name="Persisted")

        reloaded = User.objects.get(id=self.user.id)
        self.assertTrue(reloaded.check_password("pw-abc-123"))
        self.assertEqual(reloaded.first_name, "Persisted")

    # ---- validated_data mutation ---------------------------------------

    def test_validated_data_is_mutated(self):
        data = {"first_name": "Ann", "last_name": "Bee", "unknown_field": 1}
        self.serializer.update(self.user, data)
        # Every handled key is popped; unhandled keys survive untouched.
        self.assertEqual(data, {"unknown_field": 1})

    def test_unknown_key_is_ignored(self):
        before = self.user.first_name
        self._update(not_a_field="x")
        self.assertEqual(self.user.first_name, before)

    def test_empty_payload_returns_instance_unchanged(self):
        result = self._update()
        self.assertIs(result, self.user)

    # ---- plain profile fields ------------------------------------------

    def test_profile_fields_are_saved(self):
        self._update(
            email="new@example.com",
            first_name="First",
            last_name="Last",
            transcode_videos=True,
        )
        reloaded = User.objects.get(id=self.user.id)
        self.assertEqual(reloaded.email, "new@example.com")
        self.assertEqual(reloaded.first_name, "First")
        self.assertEqual(reloaded.last_name, "Last")
        self.assertTrue(reloaded.transcode_videos)

    def test_nextcloud_fields_are_saved(self):
        self._update(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="nc-user",
            nextcloud_app_password="nc-secret",
            nextcloud_scan_directory="/nc/photos",
        )
        reloaded = User.objects.get(id=self.user.id)
        self.assertEqual(reloaded.nextcloud_server_address, "https://cloud.example.com")
        self.assertEqual(reloaded.nextcloud_username, "nc-user")
        self.assertEqual(reloaded.nextcloud_app_password, "nc-secret")
        self.assertEqual(reloaded.nextcloud_scan_directory, "/nc/photos")

    def test_face_and_clustering_fields_are_saved(self):
        self._update(
            confidence=0.42,
            confidence_person=0.55,
            min_cluster_size=7,
            confidence_unknown_face=0.33,
            min_samples=3,
            cluster_selection_epsilon=0.11,
        )
        reloaded = User.objects.get(id=self.user.id)
        self.assertAlmostEqual(reloaded.confidence, 0.42)
        self.assertAlmostEqual(reloaded.confidence_person, 0.55)
        self.assertEqual(reloaded.min_cluster_size, 7)
        self.assertAlmostEqual(reloaded.confidence_unknown_face, 0.33)
        self.assertEqual(reloaded.min_samples, 3)
        self.assertAlmostEqual(reloaded.cluster_selection_epsilon, 0.11)

    def test_display_and_disk_fields_are_saved(self):
        self._update(
            favorite_min_rating=4,
            save_metadata_to_disk="MEDIA_FILE",
            save_face_tags_to_disk=True,
            image_scale=2,
            text_alignment="right",
            header_size="large",
            datetime_rules='[{"id": 1}]',
            default_timezone="Europe/Berlin",
            public_sharing=True,
            llm_settings={"enabled": True},
        )
        reloaded = User.objects.get(id=self.user.id)
        self.assertEqual(reloaded.favorite_min_rating, 4)
        self.assertEqual(reloaded.save_metadata_to_disk, "MEDIA_FILE")
        self.assertTrue(reloaded.save_face_tags_to_disk)
        self.assertEqual(reloaded.image_scale, 2)
        self.assertEqual(reloaded.text_alignment, "right")
        self.assertEqual(reloaded.header_size, "large")
        self.assertEqual(reloaded.datetime_rules, '[{"id": 1}]')
        self.assertEqual(reloaded.default_timezone, "Europe/Berlin")
        self.assertTrue(reloaded.public_sharing)
        self.assertEqual(reloaded.llm_settings, {"enabled": True})

    def test_raw_slideshow_and_duplicate_fields_are_saved(self):
        self._update(
            skip_raw_files=True,
            stack_raw_jpeg=True,
            slideshow_interval=9,
            duplicate_sensitivity=12,
            duplicate_clear_existing=True,
        )
        reloaded = User.objects.get(id=self.user.id)
        self.assertTrue(reloaded.skip_raw_files)
        self.assertTrue(reloaded.stack_raw_jpeg)
        self.assertEqual(reloaded.slideshow_interval, 9)
        # duplicate_sensitivity is a CharField: the int round-trips as a string.
        self.assertEqual(reloaded.duplicate_sensitivity, "12")
        self.assertTrue(reloaded.duplicate_clear_existing)

    def test_avatar_is_saved(self):
        self._update(avatar="avatars/pic.png")
        self.assertEqual(User.objects.get(id=self.user.id).avatar, "avatars/pic.png")

    def test_scan_directory_is_not_handled_by_this_update(self):
        """scan_directory is silently dropped -- UserSerializer.update ignores it."""
        data = {"scan_directory": "/somewhere/else"}
        before = self.user.scan_directory
        self.serializer.update(self.user, data)
        self.assertEqual(self.user.scan_directory, before)
        # ... and the key is left in validated_data (not popped).
        self.assertEqual(data, {"scan_directory": "/somewhere/else"})

    # ---- semantic_search_topk branch ------------------------------------

    @patch("api.serializers.user.batch_calculate_clip_embedding")
    @patch("api.serializers.user.download_models")
    @patch("api.serializers.user.do_all_models_exist", return_value=True)
    @patch("api.serializers.user.Chain")
    def test_semantic_search_topk_zero_to_positive_runs_chain(
        self, chain_cls, models_exist, download_models, batch_embed
    ):
        chain = MagicMock()
        chain_cls.return_value = chain
        self.user.semantic_search_topk = 0
        self.user.save()

        self._update(semantic_search_topk=10)

        chain_cls.assert_called_once_with()
        chain.run.assert_called_once_with()
        # models exist -> only the embedding task is chained
        self.assertEqual(chain.append.call_count, 1)
        self.assertIs(chain.append.call_args[0][0], batch_embed)
        self.assertEqual(chain.append.call_args[0][1].id, self.user.id)
        self.assertEqual(User.objects.get(id=self.user.id).semantic_search_topk, 10)

    @patch("api.serializers.user.batch_calculate_clip_embedding")
    @patch("api.serializers.user.download_models")
    @patch("api.serializers.user.do_all_models_exist", return_value=False)
    @patch("api.serializers.user.Chain")
    def test_semantic_search_topk_chains_download_when_models_missing(
        self, chain_cls, models_exist, download_models, batch_embed
    ):
        chain = MagicMock()
        chain_cls.return_value = chain
        self.user.semantic_search_topk = 0
        self.user.save()

        self._update(semantic_search_topk=5)

        self.assertEqual(chain.append.call_count, 2)
        self.assertIs(chain.append.call_args_list[0][0][0], download_models)
        self.assertIs(chain.append.call_args_list[1][0][0], batch_embed)
        chain.run.assert_called_once_with()

    @patch("api.serializers.user.Chain")
    def test_semantic_search_topk_positive_to_positive_skips_chain(self, chain_cls):
        self.user.semantic_search_topk = 3
        self.user.save()

        self._update(semantic_search_topk=20)

        chain_cls.assert_not_called()
        self.assertEqual(User.objects.get(id=self.user.id).semantic_search_topk, 20)

    @patch("api.serializers.user.Chain")
    def test_semantic_search_topk_zero_to_zero_skips_chain(self, chain_cls):
        self.user.semantic_search_topk = 0
        self.user.save()

        self._update(semantic_search_topk=0)

        chain_cls.assert_not_called()
        self.assertEqual(User.objects.get(id=self.user.id).semantic_search_topk, 0)


class ManageUserSerializerUpdateTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.serializer = ManageUserSerializer()
        self.tmpdir = tempfile.mkdtemp()

    def _update(self, **data):
        return self.serializer.update(self.user, data)

    # ---- password branch ------------------------------------------------

    def test_password_is_hashed_and_persisted(self):
        """Unlike UserSerializer, this update always saves at the end."""
        self._update(password="manage-pw-1")
        self.assertTrue(User.objects.get(id=self.user.id).check_password("manage-pw-1"))

    def test_empty_password_is_ignored(self):
        with patch.object(User, "set_password") as set_password:
            self._update(password="")
        set_password.assert_not_called()

    @override_settings(DEMO_SITE=True)
    def test_password_ignored_on_demo_site(self):
        with patch.object(User, "set_password") as set_password:
            self._update(password="whatever")
        set_password.assert_not_called()

    # ---- scan_directory branch -----------------------------------------

    def test_scan_directory_inside_data_root_and_existing_is_accepted(self):
        with override_settings(DATA_ROOT=self.tmpdir):
            target = os.path.join(self.tmpdir, "photos")
            os.makedirs(target, exist_ok=True)
            self._update(scan_directory=target)

        self.assertEqual(
            User.objects.get(id=self.user.id).scan_directory,
            os.path.abspath(target),
        )

    def test_scan_directory_outside_data_root_raises(self):
        with override_settings(DATA_ROOT=os.path.join(self.tmpdir, "root")):
            os.makedirs(os.path.join(self.tmpdir, "root"), exist_ok=True)
            outside = os.path.join(self.tmpdir, "elsewhere")
            os.makedirs(outside, exist_ok=True)
            with self.assertRaises(ValidationError) as ctx:
                self._update(scan_directory=outside)

        self.assertIn(
            "Scan directory must be inside the data root.", str(ctx.exception)
        )

    def test_scan_directory_inside_root_but_missing_raises(self):
        with override_settings(DATA_ROOT=self.tmpdir):
            missing = os.path.join(self.tmpdir, "does-not-exist")
            with self.assertRaises(ValidationError) as ctx:
                self._update(scan_directory=missing)

        self.assertIn("Scan directory does not exist", str(ctx.exception))

    def test_empty_scan_directory_is_silently_ignored(self):
        before = self.user.scan_directory
        self._update(scan_directory="")
        self.assertEqual(User.objects.get(id=self.user.id).scan_directory, before)

    def test_validation_error_leaves_nothing_persisted(self):
        """The instance is mutated in memory but save() is never reached."""
        with override_settings(DATA_ROOT=self.tmpdir):
            with self.assertRaises(ValidationError):
                self._update(
                    first_name="ShouldNotStick",
                    scan_directory=os.path.join(self.tmpdir, "nope"),
                )
        self.assertNotEqual(
            User.objects.get(id=self.user.id).first_name, "ShouldNotStick"
        )

    # ---- username branch ------------------------------------------------

    def test_username_change_is_saved(self):
        self._update(username="brand-new-name")
        self.assertEqual(User.objects.get(id=self.user.id).username, "brand-new-name")

    def test_username_unchanged_for_same_user_is_allowed(self):
        self._update(username=self.user.username)
        self.assertEqual(User.objects.get(id=self.user.id).username, self.user.username)

    def test_taken_username_raises(self):
        other = create_test_user()
        with self.assertRaises(ValidationError) as ctx:
            self._update(username=other.username)
        self.assertIn("User name is already taken", str(ctx.exception))
        self.assertNotEqual(User.objects.get(id=self.user.id).username, other.username)

    def test_empty_username_bypasses_uniqueness_check_and_is_assigned(self):
        """Quirk: '' skips the duplicate check but is still assigned."""
        self._update(username="")
        self.assertEqual(User.objects.get(id=self.user.id).username, "")

    # ---- remaining fields ------------------------------------------------

    def test_raw_flags_and_profile_fields_are_saved(self):
        self._update(
            skip_raw_files=True,
            stack_raw_jpeg=True,
            email="manage@example.com",
            first_name="Man",
            last_name="Age",
        )
        reloaded = User.objects.get(id=self.user.id)
        self.assertTrue(reloaded.skip_raw_files)
        self.assertTrue(reloaded.stack_raw_jpeg)
        self.assertEqual(reloaded.email, "manage@example.com")
        self.assertEqual(reloaded.first_name, "Man")
        self.assertEqual(reloaded.last_name, "Age")

    def test_validated_data_is_mutated_and_unknown_keys_survive(self):
        data = {"first_name": "Zed", "confidence": 0.9}
        self.serializer.update(self.user, data)
        # confidence is in Meta.fields but this update() does not handle it.
        self.assertEqual(data, {"confidence": 0.9})

    def test_empty_payload_still_saves_and_returns_instance(self):
        result = self._update()
        self.assertIs(result, self.user)
