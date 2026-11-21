import base64
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps as global_apps
from django.core.exceptions import FieldError
from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings

from api.models import EmailConfig, User
from api.models.encrypted_fields import (
    UndecryptableValueError,
    decrypt_text,
    encrypt_text,
    is_legacy_token,
    legacy_decrypt,
)
from api.tests.utils import create_test_user

FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "encrypted_fields"
        / "django_cryptography_tokens.json"
    ).read_text(encoding="utf-8")
)
LEGACY_KEY = FIXTURE["secret_key"]
TEXT_VALUE = next(
    row
    for row in FIXTURE["values"]
    if row["field"] == "text" and len(row["plaintext"]) > 100
)
CHAR_VALUE = next(
    row
    for row in FIXTURE["values"]
    if row["field"] == "char" and "ä" in row["plaintext"]
)
migration_0242 = importlib.import_module("api.migrations.0242_encrypted_fields_fernet")
legacy_encrypt = migration_0242.legacy_encrypt


def _token(row: dict[str, str]) -> bytes:
    return base64.b64decode(row["token"])


def _stored(table: str, column: str, pk: object) -> bytes:
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT {column} FROM {table} WHERE id = %s", [pk])
        (value,) = cursor.fetchone()
    return bytes(value)


def _store(table: str, column: str, pk: object, token: bytes) -> None:
    with connection.cursor() as cursor:
        cursor.execute(f"UPDATE {table} SET {column} = %s WHERE id = %s", [token, pk])


@override_settings(SECRET_KEY=LEGACY_KEY)
class DjangoCryptographyTokensTest(SimpleTestCase):
    def test_every_value_the_library_wrote_decrypts(self):
        for row in FIXTURE["values"]:
            with self.subTest(field=row["field"], plaintext=row["plaintext"][:20]):
                self.assertTrue(is_legacy_token(_token(row)))
                self.assertEqual(row["plaintext"], legacy_decrypt(_token(row)))
                self.assertEqual(row["plaintext"], decrypt_text(_token(row)))

    def test_a_pickle_of_anything_but_text_is_refused(self):
        for row in FIXTURE["rejected"]:
            with self.subTest(case=row["case"]):
                with self.assertRaises(UndecryptableValueError):
                    legacy_decrypt(_token(row))

    def test_a_pickled_call_is_never_made(self):
        (row,) = [row for row in FIXTURE["rejected"] if row["case"] == "global_reduce"]
        with patch("builtins.print") as printed:
            with self.assertRaises(UndecryptableValueError):
                legacy_decrypt(_token(row))
        printed.assert_not_called()

    def test_a_changed_byte_fails_the_signature(self):
        token = bytearray(_token(CHAR_VALUE))
        token[20] ^= 1
        with self.assertRaises(UndecryptableValueError):
            legacy_decrypt(bytes(token))

    def test_a_short_value_is_refused(self):
        with self.assertRaises(UndecryptableValueError):
            legacy_decrypt(b"\x80" + bytes(20))

    def test_legacy_encrypt_writes_what_legacy_decrypt_reads(self):
        for value in ("", "app-password", "päss \U0001f511", "x" * 4000):
            with self.subTest(value=value[:20]):
                token = legacy_encrypt(value)
                self.assertTrue(is_legacy_token(token))
                self.assertEqual(value, legacy_decrypt(token))


class WrongKeyTest(SimpleTestCase):
    def test_a_library_value_does_not_decrypt_with_another_key(self):
        with self.assertRaises(UndecryptableValueError):
            legacy_decrypt(_token(CHAR_VALUE))

    def test_a_value_does_not_decrypt_with_another_key(self):
        with override_settings(SECRET_KEY="the-key-it-was-encrypted-with"):
            token = encrypt_text("app-password")
        with override_settings(SECRET_KEY="another-key"):
            with self.assertRaises(UndecryptableValueError):
                decrypt_text(token)


class RoundTripTest(SimpleTestCase):
    def test_text_comes_back_as_it_went_in(self):
        for value in ("", " ", "app-password", "päss \U0001f511 密", "y" * 10000):
            with self.subTest(value=value[:20]):
                token = encrypt_text(value)
                self.assertFalse(is_legacy_token(token))
                self.assertEqual(value, decrypt_text(token))

    def test_the_same_value_encrypts_differently_each_time(self):
        self.assertNotEqual(encrypt_text("app-password"), encrypt_text("app-password"))

    def test_the_value_is_not_in_the_token(self):
        token = encrypt_text("app-password")
        self.assertNotIn(b"app-password", token)
        self.assertNotIn(b"app-password", base64.urlsafe_b64decode(token))

    def test_a_damaged_token_is_refused(self):
        token = bytearray(encrypt_text("app-password"))
        token[30] = ord("A") if token[30] != ord("A") else ord("B")
        with self.assertRaises(UndecryptableValueError):
            decrypt_text(bytes(token))


class EncryptedColumnsTest(TestCase):
    def test_the_nextcloud_app_password_is_stored_encrypted(self):
        user = create_test_user()
        user.nextcloud_app_password = "app-password"
        user.save(update_fields=["nextcloud_app_password"])

        stored = _stored("api_user", "nextcloud_app_password", user.pk)
        self.assertNotIn(b"app-password", stored)
        self.assertEqual("app-password", decrypt_text(stored))
        self.assertEqual(
            "app-password", User.objects.get(pk=user.pk).nextcloud_app_password
        )

    def test_the_email_secret_is_stored_encrypted(self):
        config = EmailConfig.load()
        config.secret = "smtp-secret"
        config.save()

        stored = _stored("api_emailconfig", "secret", config.pk)
        self.assertNotIn(b"smtp-secret", stored)
        self.assertEqual("smtp-secret", EmailConfig.objects.get(pk=config.pk).secret)

    def test_an_empty_value_stays_empty(self):
        user = create_test_user()
        self.assertEqual("", User.objects.get(pk=user.pk).nextcloud_app_password)
        self.assertEqual(
            "", decrypt_text(_stored("api_user", "nextcloud_app_password", user.pk))
        )

    @override_settings(SECRET_KEY=LEGACY_KEY)
    def test_a_row_the_library_wrote_still_reads(self):
        user = create_test_user()
        _store("api_user", "nextcloud_app_password", user.pk, _token(CHAR_VALUE))

        self.assertEqual(
            CHAR_VALUE["plaintext"], User.objects.get(pk=user.pk).nextcloud_app_password
        )

    def test_only_isnull_is_a_lookup(self):
        self.assertFalse(
            User.objects.filter(nextcloud_app_password__isnull=True).exists()
        )
        with self.assertRaises(FieldError):
            User.objects.filter(nextcloud_app_password="app-password").exists()


@override_settings(SECRET_KEY=LEGACY_KEY)
class ReencryptMigrationTest(TestCase):
    def _run(self, step):
        step(global_apps, SimpleNamespace(connection=connection))

    def test_library_values_are_rewritten_in_the_new_format(self):
        user = create_test_user()
        _store("api_user", "nextcloud_app_password", user.pk, _token(CHAR_VALUE))
        config = EmailConfig.load()
        _store("api_emailconfig", "secret", config.pk, _token(TEXT_VALUE))

        self._run(migration_0242.reencrypt)

        stored = _stored("api_user", "nextcloud_app_password", user.pk)
        self.assertFalse(is_legacy_token(stored))
        self.assertEqual(CHAR_VALUE["plaintext"], decrypt_text(stored))
        email_stored = _stored("api_emailconfig", "secret", config.pk)
        self.assertFalse(is_legacy_token(email_stored))
        self.assertEqual(TEXT_VALUE["plaintext"], decrypt_text(email_stored))

    def test_new_values_are_left_alone(self):
        user = create_test_user()
        user.nextcloud_app_password = "app-password"
        user.save(update_fields=["nextcloud_app_password"])
        before = _stored("api_user", "nextcloud_app_password", user.pk)

        self._run(migration_0242.reencrypt)

        self.assertEqual(before, _stored("api_user", "nextcloud_app_password", user.pk))

    def test_the_reverse_writes_what_the_library_reads(self):
        user = create_test_user()
        user.nextcloud_app_password = "app-password"
        user.save(update_fields=["nextcloud_app_password"])

        self._run(migration_0242.restore_legacy_format)

        stored = _stored("api_user", "nextcloud_app_password", user.pk)
        self.assertTrue(is_legacy_token(stored))
        self.assertEqual("app-password", legacy_decrypt(stored))

    def test_a_value_encrypted_with_another_key_stops_the_migration(self):
        user = create_test_user()
        _store("api_user", "nextcloud_app_password", user.pk, _token(CHAR_VALUE))

        with override_settings(SECRET_KEY="another-key"):
            with self.assertRaisesMessage(UndecryptableValueError, "api_user"):
                self._run(migration_0242.reencrypt)

        self.assertTrue(
            is_legacy_token(_stored("api_user", "nextcloud_app_password", user.pk))
        )
