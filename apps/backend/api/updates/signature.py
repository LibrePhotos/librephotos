"""Whether an update comes from the LibrePhotos maintainers (#2788, #2317).

The SHA-256 in a release's ``SHA256SUMS`` proves that the zip arrived intact,
but anyone who can publish a release could publish both. A signature of
``SHA256SUMS`` made with a key only the release workflow holds, checked
against the public key built into the app, would prove who made them.

Which signing setup the project uses is still the maintainer's decision
(#2317), so no key is built in: ``PUBLIC_KEY`` is None and the updater checks
the SHA-256 only. Once a key is decided, the release workflow signs
``SHA256SUMS`` with minisign (Ed25519) into ``SHA256SUMS.minisig``, its public
key goes into ``PUBLIC_KEY``, and from that release on an update without a
valid signature is refused.
"""

from __future__ import annotations

import base64
import binascii
import hashlib

# The base64 line of minisign.pub ("RW..."), or None while #2317 is open.
PUBLIC_KEY: str | None = None
SIGNATURE_NAME = "SHA256SUMS.minisig"

_ED25519 = b"Ed"
# minisign 0.10+ signs a BLAKE2b-512 hash of the file ("prehashed").
_ED25519_PREHASHED = b"ED"
_KEY_ID_BYTES = 8
_PUBLIC_KEY_BYTES = 32
_SIGNATURE_BYTES = 64
_UNTRUSTED_PREFIX = "untrusted comment:"
_TRUSTED_PREFIX = "trusted comment: "


class SignatureError(Exception):
    """The signature is malformed, made with another key, or does not match."""


def _decode(text: str, size: int, what: str) -> bytes:
    try:
        raw = base64.b64decode(text.strip(), validate=True)
    except (binascii.Error, ValueError) as error:
        raise SignatureError(f"{what} is not base64") from error
    if len(raw) != size:
        raise SignatureError(f"{what} has the wrong length")
    return raw


def _signature_lines(signature: str) -> tuple[bytes, str, bytes]:
    """The signature, the trusted comment and the global signature."""
    lines = signature.strip().splitlines()
    if (
        len(lines) != 4
        or not lines[0].startswith(_UNTRUSTED_PREFIX)
        or not lines[2].startswith(_TRUSTED_PREFIX)
    ):
        raise SignatureError("not a minisign signature")
    signed = _decode(lines[1], 2 + _KEY_ID_BYTES + _SIGNATURE_BYTES, "the signature")
    trusted = lines[2][len(_TRUSTED_PREFIX) :]
    return signed, trusted, _decode(lines[3], _SIGNATURE_BYTES, "the global signature")


def _signed_data(algorithm: bytes, message: bytes) -> bytes:
    if algorithm == _ED25519:
        return message
    if algorithm == _ED25519_PREHASHED:
        return hashlib.blake2b(message, digest_size=64).digest()
    raise SignatureError("unknown signature algorithm")


def verify_minisign(message: bytes, signature: str, public_key: str) -> None:
    """Raise SignatureError unless ``signature`` (a .minisig file's text) is
    ``public_key``'s signature of ``message``, trusted comment included."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    key = _decode(public_key, 2 + _KEY_ID_BYTES + _PUBLIC_KEY_BYTES, "the public key")
    if key[:2] != _ED25519:
        raise SignatureError("not an Ed25519 public key")
    signed, trusted, global_signature = _signature_lines(signature)
    if signed[2 : 2 + _KEY_ID_BYTES] != key[2 : 2 + _KEY_ID_BYTES]:
        raise SignatureError("signed with another key")
    verifier = Ed25519PublicKey.from_public_bytes(key[2 + _KEY_ID_BYTES :])
    signature_bytes = signed[2 + _KEY_ID_BYTES :]
    try:
        verifier.verify(signature_bytes, _signed_data(signed[:2], message))
        verifier.verify(global_signature, signature_bytes + trusted.encode("utf-8"))
    except InvalidSignature as error:
        raise SignatureError("the signature does not match") from error
