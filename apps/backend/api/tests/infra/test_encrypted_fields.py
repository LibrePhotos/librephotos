import base64
import importlib
import importlib.util
import json
import re
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet
from django.apps import apps as global_apps
from django.conf import settings
from django.core.exceptions import FieldError
from django.core.signing import BadSignature
from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings

from api.models import EmailConfig, User
from api.models.encrypted_fields import (
    LEGACY_HEADER,
    LEGACY_VERSION,
    UndecryptableValueError,
    decrypt_text,
    encrypt_text,
    field_key,
    is_legacy_token,
    legacy_decrypt,
)
from api.tests.utils import create_test_user

migration_0242 = importlib.import_module("api.migrations.0242_encrypted_fields_fernet")
legacy_encrypt = migration_0242.legacy_encrypt

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


def _token(row: dict[str, str]) -> bytes:
    return base64.b64decode(row["token"])


def _fernet_token(secret_key: str, value: str) -> bytes:
    return Fernet(field_key(secret_key)).encrypt(value.encode("utf-8"))


def _stored(table: str, column: str, pk: object) -> bytes:
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT {column} FROM {table} WHERE id = %s", [pk])
        (value,) = cursor.fetchone()
    return bytes(value)


def _store(table: str, column: str, pk: object, value: bytes | str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(f"UPDATE {table} SET {column} = %s WHERE id = %s", [value, pk])


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

    def test_legacy_encrypt_writes_the_librarys_header(self):
        token = legacy_encrypt("app-password")

        version, stamp = LEGACY_HEADER.unpack(token[: LEGACY_HEADER.size])
        self.assertEqual(LEGACY_VERSION, version)
        self.assertLess(abs(time.time() - stamp), 60)
        self.assertEqual(0, (len(token) - LEGACY_HEADER.size - 16 - 32) % 16)

    @unittest.skipUnless(
        importlib.util.find_spec("django_cryptography"),
        "django-cryptography is not installed",
    )
    def test_the_library_reads_what_legacy_encrypt_writes(self):
        from django.db import models
        from django_cryptography.fields import encrypt

        field = encrypt(models.TextField())
        for value in ("", "app-password", "päss \U0001f511", "x" * 4000):
            with self.subTest(value=value[:20]):
                self.assertEqual(value, field._load(legacy_encrypt(value)))

    def test_the_same_value_encrypts_differently_each_time(self):
        self.assertNotEqual(
            legacy_encrypt("app-password"), legacy_encrypt("app-password")
        )
        self.assertNotIn(b"app-password", legacy_encrypt("app-password"))


class WrongKeyTest(SimpleTestCase):
    def test_a_library_value_does_not_decrypt_with_another_key(self):
        with self.assertRaises(UndecryptableValueError):
            legacy_decrypt(_token(CHAR_VALUE))

    def test_a_fernet_value_does_not_decrypt_with_another_key(self):
        with self.assertRaises(UndecryptableValueError):
            decrypt_text(_fernet_token("the-key-it-was-encrypted-with", "secret"))

    def test_the_error_is_a_bad_signature(self):
        with self.assertRaises(BadSignature):
            decrypt_text(_token(CHAR_VALUE))


class FernetReadTest(SimpleTestCase):
    def test_a_fernet_token_under_secret_key_decrypts(self):
        with override_settings(SECRET_KEY="current-key"):
            token = _fernet_token("current-key", "päss \U0001f511")
            self.assertFalse(is_legacy_token(token))
            self.assertEqual("päss \U0001f511", decrypt_text(token))

    def test_a_damaged_fernet_token_is_refused(self):
        token = bytearray(_fernet_token("current-key", "app-password"))
        token[30] = ord("A") if token[30] != ord("A") else ord("B")
        with override_settings(SECRET_KEY="current-key"):
            with self.assertRaises(UndecryptableValueError):
                decrypt_text(bytes(token))


class SecretKeyFallbacksTest(SimpleTestCase):
    def test_a_value_under_a_fallback_key_decrypts(self):
        with override_settings(SECRET_KEY="new-key", SECRET_KEY_FALLBACKS=[LEGACY_KEY]):
            self.assertEqual(CHAR_VALUE["plaintext"], decrypt_text(_token(CHAR_VALUE)))
            self.assertEqual(
                "rotated", decrypt_text(_fernet_token(LEGACY_KEY, "rotated"))
            )

    def test_new_values_are_written_under_secret_key(self):
        with override_settings(SECRET_KEY="new-key", SECRET_KEY_FALLBACKS=[LEGACY_KEY]):
            token = encrypt_text("app-password")
        with override_settings(SECRET_KEY="new-key"):
            self.assertEqual("app-password", decrypt_text(token))


class EncryptedColumnsTest(TestCase):
    def test_the_nextcloud_app_password_is_stored_as_a_fernet_token(self):
        user = create_test_user()
        user.nextcloud_app_password = "app-password"
        user.save(update_fields=["nextcloud_app_password"])

        stored = _stored("api_user", "nextcloud_app_password", user.pk)
        self.assertFalse(is_legacy_token(stored))
        self.assertNotIn(b"app-password", stored)
        self.assertEqual(
            b"app-password", Fernet(field_key(settings.SECRET_KEY)).decrypt(stored)
        )
        self.assertEqual(
            "app-password", User.objects.get(pk=user.pk).nextcloud_app_password
        )

    def test_the_email_secret_is_stored_as_a_fernet_token(self):
        config = EmailConfig.load()
        config.secret = "smtp-secret"
        config.save()

        stored = _stored("api_emailconfig", "secret", config.pk)
        self.assertFalse(is_legacy_token(stored))
        self.assertNotIn(b"smtp-secret", stored)
        self.assertEqual("smtp-secret", EmailConfig.objects.get(pk=config.pk).secret)

    def test_an_empty_value_is_stored_encrypted_and_reads_back_empty(self):
        user = create_test_user()
        stored = _stored("api_user", "nextcloud_app_password", user.pk)

        self.assertTrue(stored)
        self.assertEqual("", decrypt_text(stored))
        self.assertEqual("", User.objects.get(pk=user.pk).nextcloud_app_password)

    def test_an_empty_column_reads_as_an_empty_value(self):
        user = create_test_user()
        for empty in (b"", ""):
            with self.subTest(empty=empty):
                _store("api_user", "nextcloud_app_password", user.pk, empty)
                self.assertEqual(
                    "", User.objects.get(pk=user.pk).nextcloud_app_password
                )

    @override_settings(SECRET_KEY=LEGACY_KEY)
    def test_a_row_the_library_wrote_reads(self):
        user = create_test_user()
        _store("api_user", "nextcloud_app_password", user.pk, _token(CHAR_VALUE))

        self.assertEqual(
            CHAR_VALUE["plaintext"], User.objects.get(pk=user.pk).nextcloud_app_password
        )

    def test_a_row_in_the_fernet_format_reads(self):
        user = create_test_user()
        token = _fernet_token(settings.SECRET_KEY, "from-the-next-release")
        _store("api_user", "nextcloud_app_password", user.pk, token)

        self.assertEqual(
            "from-the-next-release",
            User.objects.get(pk=user.pk).nextcloud_app_password,
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

    def test_library_values_are_rewritten_as_fernet_tokens(self):
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

    def test_a_value_under_a_fallback_key_is_rewritten_under_secret_key(self):
        user = create_test_user()
        _store("api_user", "nextcloud_app_password", user.pk, _token(CHAR_VALUE))

        with override_settings(SECRET_KEY="new-key", SECRET_KEY_FALLBACKS=[LEGACY_KEY]):
            self._run(migration_0242.reencrypt)
        with override_settings(SECRET_KEY="new-key"):
            self.assertEqual(
                CHAR_VALUE["plaintext"],
                decrypt_text(_stored("api_user", "nextcloud_app_password", user.pk)),
            )

    def test_fernet_values_are_left_alone(self):
        user = create_test_user()
        before = _stored("api_user", "nextcloud_app_password", user.pk)

        self._run(migration_0242.reencrypt)

        self.assertEqual(before, _stored("api_user", "nextcloud_app_password", user.pk))

    def test_empty_columns_become_an_encrypted_empty_value(self):
        user = create_test_user()
        config = EmailConfig.load()
        _store("api_user", "nextcloud_app_password", user.pk, b"")
        _store("api_emailconfig", "secret", config.pk, "")

        self._run(migration_0242.reencrypt)

        for table, column, pk in (
            ("api_user", "nextcloud_app_password", user.pk),
            ("api_emailconfig", "secret", config.pk),
        ):
            with self.subTest(table=table):
                stored = _stored(table, column, pk)
                self.assertTrue(stored)
                self.assertEqual("", decrypt_text(stored))

    def test_the_reverse_writes_what_the_library_reads(self):
        user = create_test_user()
        user.nextcloud_app_password = "app-password"
        user.save(update_fields=["nextcloud_app_password"])

        self._run(migration_0242.restore_legacy_format)

        stored = _stored("api_user", "nextcloud_app_password", user.pk)
        self.assertTrue(is_legacy_token(stored))
        self.assertEqual("app-password", legacy_decrypt(stored))

    def test_a_value_no_key_decrypts_stops_with_a_command_that_fixes_it(self):
        user = create_test_user()
        _store("api_user", "nextcloud_app_password", user.pk, _token(CHAR_VALUE))

        with override_settings(SECRET_KEY="another-key"):
            with self.assertRaises(UndecryptableValueError) as raised:
                self._run(migration_0242.reencrypt)
            message = str(raised.exception)
            self.assertIn(f"api_user.nextcloud_app_password of row {user.pk}", message)
            self.assertTrue(
                is_legacy_token(_stored("api_user", "nextcloud_app_password", user.pk))
            )

            (command,) = re.findall(r'python manage\.py shell -c "(.*)"$', message)
            exec(command, {})
            self._run(migration_0242.reencrypt)

            self.assertEqual("", User.objects.get(pk=user.pk).nextcloud_app_password)

    def test_the_command_names_the_email_configuration(self):
        self.assertEqual(
            'python manage.py shell -c "from api.models import EmailConfig; '
            "EmailConfig.objects.filter(pk=1).update(secret='')\"",
            migration_0242.recovery_command("EmailConfig", "secret", 1),
        )
