import hmac
import pickle
import struct
from base64 import urlsafe_b64encode
from collections.abc import Callable
from functools import lru_cache
from hashlib import sha256
from io import BytesIO

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from django.conf import settings
from django.db import models
from django.db.backends.base.base import BaseDatabaseWrapper
from django.db.models.lookups import Lookup
from django.utils.encoding import force_bytes

FIELD_KEY_INFO = b"librephotos encrypted model field v1"
LEGACY_VERSION = b"\x80"
LEGACY_HEADER = struct.Struct(">cQ")
LEGACY_IV_BYTES = 16
LEGACY_SIGNATURE_BYTES = 32
LEGACY_SALT = b"django-cryptography"
LEGACY_ITERATIONS = 30000
SUPPORTED_LOOKUPS = frozenset({"isnull"})


class UndecryptableValueError(ValueError):
    pass


@lru_cache(maxsize=8)
def _field_key(secret_key: str) -> bytes:
    derived = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=FIELD_KEY_INFO
    ).derive(force_bytes(secret_key))
    return urlsafe_b64encode(derived)


def _fernet() -> Fernet:
    return Fernet(_field_key(settings.SECRET_KEY))


def is_legacy_token(token: bytes) -> bool:
    return token[:1] == LEGACY_VERSION


def encrypt_text(value: str) -> bytes:
    return _fernet().encrypt(value.encode("utf-8"))


def decrypt_text(token: bytes) -> str:
    if is_legacy_token(token):
        return legacy_decrypt(token)
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError) as error:
        raise UndecryptableValueError(
            "an encrypted value does not decrypt with SECRET_KEY"
        ) from error


@lru_cache(maxsize=8)
def legacy_cipher_key(secret_key: str) -> bytes:
    return PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=LEGACY_SALT,
        iterations=LEGACY_ITERATIONS,
    ).derive(force_bytes(secret_key))


def legacy_signature(secret_key: str, signed: bytes) -> bytes:
    return hmac.new(force_bytes(secret_key), signed, sha256).digest()


class _TextOnlyUnpickler(pickle.Unpickler):
    def find_class(
        self, module_name: str, global_name: str, /
    ) -> Callable[..., object]:
        raise UndecryptableValueError(
            f"a legacy value names {module_name}.{global_name}"
        )


def _unpickled_text(data: bytes) -> str:
    try:
        value = _TextOnlyUnpickler(BytesIO(data)).load()
    except UndecryptableValueError:
        raise
    except Exception as error:
        raise UndecryptableValueError("a legacy value is no pickle") from error
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError as error:
            raise UndecryptableValueError("a legacy value is no text") from error
    if not isinstance(value, str):
        raise UndecryptableValueError(
            f"a legacy value is a {type(value).__name__}, not text"
        )
    return value


def _legacy_plaintext(token: bytes, secret_key: str) -> bytes | None:
    signed, signature = token[:-LEGACY_SIGNATURE_BYTES], token[-LEGACY_SIGNATURE_BYTES:]
    if not hmac.compare_digest(signature, legacy_signature(secret_key, signed)):
        return None
    iv = signed[LEGACY_HEADER.size : LEGACY_HEADER.size + LEGACY_IV_BYTES]
    ciphertext = signed[LEGACY_HEADER.size + LEGACY_IV_BYTES :]
    decryptor = Cipher(
        algorithms.AES(legacy_cipher_key(secret_key)), modes.CBC(iv)
    ).decryptor()
    unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
    try:
        padded = decryptor.update(ciphertext) + decryptor.finalize()
        return unpadder.update(padded) + unpadder.finalize()
    except ValueError as error:
        raise UndecryptableValueError(
            "a django-cryptography value is damaged"
        ) from error


def legacy_decrypt(token: bytes) -> str:
    minimum = LEGACY_HEADER.size + LEGACY_IV_BYTES + LEGACY_SIGNATURE_BYTES
    if len(token) < minimum or not is_legacy_token(token):
        raise UndecryptableValueError("not a django-cryptography value")
    plaintext = _legacy_plaintext(token, settings.SECRET_KEY)
    if plaintext is None:
        raise UndecryptableValueError(
            "a django-cryptography value does not verify with SECRET_KEY"
        )
    return _unpickled_text(plaintext)


def _to_database(value: object) -> bytes | None:
    if value is None:
        return None
    return encrypt_text(str(value))


def _from_database(value: object) -> str | None:
    if value is None:
        return None
    return decrypt_text(
        bytes(value) if isinstance(value, memoryview) else force_bytes(value)
    )


class EncryptedCharField(models.CharField):
    def get_internal_type(self) -> str:
        return "BinaryField"

    def get_db_prep_value(
        self, value: object, connection: BaseDatabaseWrapper, prepared: bool = False
    ) -> object:
        return _to_database(value if prepared else self.get_prep_value(value))

    def from_db_value(
        self, value: object, expression: object, connection: BaseDatabaseWrapper
    ) -> str | None:
        return _from_database(value)

    def get_lookup(self, lookup_name: str) -> type[Lookup] | None:
        return (
            super().get_lookup(lookup_name)
            if lookup_name in SUPPORTED_LOOKUPS
            else None
        )


class EncryptedTextField(models.TextField):
    def get_internal_type(self) -> str:
        return "BinaryField"

    def get_db_prep_value(
        self, value: object, connection: BaseDatabaseWrapper, prepared: bool = False
    ) -> object:
        return _to_database(value if prepared else self.get_prep_value(value))

    def from_db_value(
        self, value: object, expression: object, connection: BaseDatabaseWrapper
    ) -> str | None:
        return _from_database(value)

    def get_lookup(self, lookup_name: str) -> type[Lookup] | None:
        return (
            super().get_lookup(lookup_name)
            if lookup_name in SUPPORTED_LOOKUPS
            else None
        )
