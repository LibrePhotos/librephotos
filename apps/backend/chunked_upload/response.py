from typing import Any

from django.http import HttpResponse

from .settings import ENCODER, CONTENT_TYPE


class Response(HttpResponse):
    """ """

    # Positional extras were never usable here: they would have bound to
    # HttpResponse's `content` slot and clashed with the keyword below.
    def __init__(
        self, content: object, status: int | None = None, **kwargs: Any
    ) -> None:
        super(Response, self).__init__(
            content=ENCODER(content),
            content_type=CONTENT_TYPE,
            status=status,
            **kwargs,
        )
