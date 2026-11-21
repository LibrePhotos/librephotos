import os
import pickle
import time
from collections.abc import Callable

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from django.apps.registry import Apps
from django.conf import settings
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

from api.models.encrypted_fields import (
    LEGACY_HEADER,
    LEGACY_IV_BYTES,
    LEGACY_VERSION,
    UndecryptableValueError,
    decrypt_text,
    encrypt_text,
    is_legacy_token,
    legacy_cipher_key,
    legacy_decrypt,
    legacy_signature,
)

ENCRYPTED_COLUMNS = (("emailconfig", "secret"), ("user", "nextcloud_app_password"))


def _rewrite(
    apps: Apps,
    schema_editor: BaseDatabaseSchemaEditor,
    convert: Callable[[bytes], bytes | None],
) -> None:
    connection = schema_editor.connection
    quote = connection.ops.quote_name
    for model_name, field_name in ENCRYPTED_COLUMNS:
        model = apps.get_model("api", model_name)
        table = model._meta.db_table
        column = quote(model._meta.get_field(field_name).column)
        key = quote(model._meta.pk.column)
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT {key}, {column} FROM {quote(table)} WHERE {column} IS NOT NULL"
            )
            rows = cursor.fetchall()
            for pk, stored in rows:
                try:
                    replaced = convert(bytes(stored))
                except UndecryptableValueError as error:
                    raise UndecryptableValueError(
                        f"{table}.{field_name} of row {pk}: {error}. Start LibrePhotos "
                        "with the SECRET_KEY it was saved with, or clear the value."
                    ) from error
                if replaced is not None:
                    cursor.execute(
                        f"UPDATE {quote(table)} SET {column} = %s WHERE {key} = %s",
                        [replaced, pk],
                    )


def legacy_encrypt(value: str) -> bytes:
    secret_key = settings.SECRET_KEY
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(pickle.dumps(value)) + padder.finalize()
    iv = os.urandom(LEGACY_IV_BYTES)
    encryptor = Cipher(
        algorithms.AES(legacy_cipher_key(secret_key)), modes.CBC(iv)
    ).encryptor()
    signed = (
        LEGACY_HEADER.pack(LEGACY_VERSION, int(time.time()))
        + iv
        + encryptor.update(padded)
        + encryptor.finalize()
    )
    return signed + legacy_signature(secret_key, signed)


def _to_fernet(token: bytes) -> bytes | None:
    return encrypt_text(legacy_decrypt(token)) if is_legacy_token(token) else None


def _to_legacy(token: bytes) -> bytes | None:
    return None if is_legacy_token(token) else legacy_encrypt(decrypt_text(token))


def reencrypt(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite(apps, schema_editor, _to_fernet)


def restore_legacy_format(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite(apps, schema_editor, _to_legacy)


class Migration(migrations.Migration):
    dependencies = [("api", "0241_cluster_unique_cluster_id")]

    operations = [migrations.RunPython(reencrypt, restore_legacy_format)]
