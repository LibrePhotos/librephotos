"""Package signing."""

import pickle

from django_q import core_signing as signing
from django_q.conf import Conf

BadSignature = signing.BadSignature


class SignedPackage:
    """Wraps Django's signing module with custom Pickle serializer."""

    @staticmethod
    def dumps(obj, compressed: bool = Conf.COMPRESSED) -> str:
        return signing.dumps(
            obj,
            key=Conf.SECRET_KEY,
            salt=Conf.PREFIX,
            compress=compressed,
            serializer=PickleSerializer,
        )

    @staticmethod
    def loads(obj) -> any:
        return signing.loads(
            obj, key=Conf.SECRET_KEY, salt=Conf.PREFIX, serializer=PickleSerializer
        )


class PickleSerializer:
    """Simple wrapper around Pickle for signing.dumps and signing.loads."""

    @staticmethod
    def dumps(obj) -> bytes:
        return pickle.dumps(obj, protocol=pickle.HIGHEST_PROTOCOL)

    @staticmethod
    def loads(data) -> any:
        return pickle.loads(data)
