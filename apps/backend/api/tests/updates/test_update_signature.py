"""The minisign check of SHA256SUMS, ready for when a key is chosen (#2317).

No key is built in yet (PUBLIC_KEY is None); these tests make their own key
pair and sign the way minisign does."""

import base64
import hashlib

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from django.test import SimpleTestCase

from api.updates import signature
from api.updates.signature import SignatureError, verify_minisign

MESSAGE = b"abc  librephotos-windows-x64.zip\n"


def key_pair(key_id=b"12345678"):
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return private, base64.b64encode(b"Ed" + key_id + public).decode()


def minisign(private, message, key_id=b"12345678", prehashed=True, trusted="t"):
    """A .minisig file's text, as `minisign -S` writes it."""
    algorithm = b"ED" if prehashed else b"Ed"
    data = hashlib.blake2b(message, digest_size=64).digest() if prehashed else message
    signed = private.sign(data)
    global_signature = private.sign(signed + trusted.encode())
    return "\n".join(
        [
            "untrusted comment: signature from minisign secret key",
            base64.b64encode(algorithm + key_id + signed).decode(),
            f"trusted comment: {trusted}",
            base64.b64encode(global_signature).decode(),
        ]
    )


class VerifyMinisignTest(SimpleTestCase):
    def setUp(self):
        self.private, self.public = key_pair()

    def test_no_key_is_built_in_until_the_maintainer_decides(self):
        self.assertIsNone(signature.PUBLIC_KEY)

    def test_a_good_signature_passes_both_forms(self):
        for prehashed in (True, False):
            with self.subTest(prehashed=prehashed):
                verify_minisign(
                    MESSAGE,
                    minisign(self.private, MESSAGE, prehashed=prehashed),
                    self.public,
                )

    def test_a_changed_file_fails(self):
        with self.assertRaisesRegex(SignatureError, "does not match"):
            verify_minisign(
                MESSAGE + b"x", minisign(self.private, MESSAGE), self.public
            )

    def test_another_key_fails(self):
        other, _ = key_pair()
        with self.assertRaisesRegex(SignatureError, "does not match"):
            verify_minisign(MESSAGE, minisign(other, MESSAGE), self.public)
        with self.assertRaisesRegex(SignatureError, "another key"):
            verify_minisign(
                MESSAGE,
                minisign(self.private, MESSAGE, key_id=b"87654321"),
                self.public,
            )

    def test_a_changed_trusted_comment_fails(self):
        text = minisign(self.private, MESSAGE).replace(
            "trusted comment: t", "trusted comment: u"
        )
        with self.assertRaisesRegex(SignatureError, "does not match"):
            verify_minisign(MESSAGE, text, self.public)

    def test_malformed_input_fails(self):
        good = minisign(self.private, MESSAGE)
        lines = good.splitlines()
        cases = {
            "not a minisign signature": "just text",
            "not base64": "\n".join([lines[0], "!!!", *lines[2:]]),
            "wrong length": "\n".join([lines[0], "QUJD", *lines[2:]]),
            "unknown signature algorithm": "\n".join(
                [
                    lines[0],
                    base64.b64encode(b"Xx" + base64.b64decode(lines[1])[2:]).decode(),
                    *lines[2:],
                ]
            ),
        }
        for message, text in cases.items():
            with self.subTest(message), self.assertRaisesRegex(SignatureError, message):
                verify_minisign(MESSAGE, text, self.public)
        not_ed25519 = base64.b64encode(
            b"Xx" + base64.b64decode(self.public)[2:]
        ).decode()
        with self.assertRaisesRegex(SignatureError, "not an Ed25519"):
            verify_minisign(MESSAGE, good, not_ed25519)
