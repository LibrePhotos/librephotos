"""The body of a request, as the key/value object the views read it as.

``request.data`` is whatever the parser produced: a ``dict`` for a JSON object,
a ``QueryDict`` (a ``dict`` subclass) for form and multipart bodies and for an
empty form body, an empty ``dict`` for an empty JSON body - but a ``list``,
``str``, number, bool or ``None`` for any other JSON value. Views that call
``.get`` on it used to answer a JSON array body with a 500. ``request_dict``
answers it with a 400 instead.
"""

from typing import Any

from rest_framework.exceptions import ParseError
from rest_framework.request import Request


def request_dict(request: Request) -> dict[str, Any]:
    """``request.data``, or a 400 when the body is not a JSON object.

    Form and multipart bodies come back unchanged as their ``QueryDict``.
    """
    data = request.data
    if not isinstance(data, dict):
        raise ParseError("Expected a JSON object as the request body.")
    return data
