"""ASGI entry point for uvicorn.

The app stays WSGI: a2wsgi runs it in a thread pool and streams response chunks
as they are produced, where Django's own ASGI handler would buffer every sync
StreamingHttpResponse and FileResponse in memory. One thing a2wsgi lacks is
noticing that the client went away (uvicorn drops chunks silently), which
would leave an abandoned live transcode pumping ffmpeg to the end of the
video. The responder below watches for http.disconnect once the response has
started and raises into the WSGI iterable, so it is closed the way a broken
socket closed it under gunicorn.
"""

import asyncio
import os
from concurrent.futures import Future, ThreadPoolExecutor
from typing import cast

from a2wsgi import WSGIMiddleware
from a2wsgi.asgi_typing import HTTPScope, Receive, Scope, Send, SendEvent
from a2wsgi.wsgi import WSGIResponder
from a2wsgi.wsgi_typing import (
    Environ,
    ExceptionInfo,
    StartResponse,
    WriteCallable,
    WSGIApp,
)

from librephotos.wsgi import application as wsgi_application


class ClientDisconnected(Exception):
    pass


class DisconnectAwareResponder(WSGIResponder):
    def __init__(
        self, app: WSGIApp, executor: ThreadPoolExecutor, send_queue_size: int
    ) -> None:
        super().__init__(app, executor, send_queue_size)
        self.disconnected = False
        self._receive: Receive | None = None
        self._watcher: Future[None] | None = None

    async def __call__(self, scope: HTTPScope, receive: Receive, send: Send) -> None:
        self._receive = receive
        try:
            return await super().__call__(scope, receive, send)
        finally:
            if self._watcher is not None:
                self._watcher.cancel()

    async def _watch(self) -> None:
        # After the response has started the request body is done, so receive()
        # only has a disconnect left to deliver.
        receive = self._receive
        assert receive is not None  # set by __call__ before any response starts
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                self.disconnected = True
                return

    def start_response(
        self,
        status: str,
        response_headers: list[tuple[str, str]],
        exc_info: ExceptionInfo | None = None,
    ) -> WriteCallable:
        write = super().start_response(status, response_headers, exc_info)
        if self._watcher is None:
            self._watcher = asyncio.run_coroutine_threadsafe(self._watch(), self.loop)
        return write

    def send(self, message: SendEvent | None) -> None:
        if self.disconnected:
            raise ClientDisconnected()
        super().send(message)

    def wsgi(self, environ: Environ, start_response: StartResponse) -> None:
        try:
            super().wsgi(environ, start_response)
        except ClientDisconnected:
            pass


class Middleware(WSGIMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            responder = DisconnectAwareResponder(
                self.app, self.executor, self.send_queue_size
            )
            return await responder(scope, receive, send)
        return await super().__call__(scope, receive, send)


# Concurrent requests per uvicorn worker; every one holds a thread while it runs.
application = Middleware(
    # Django's WSGIHandler is annotated with a plain dict environ and an
    # HttpResponseBase result. At runtime the environ is the dict a2wsgi builds
    # and the response iterates as bytes, which is all the WSGI contract needs.
    cast(WSGIApp, wsgi_application),
    workers=int(os.environ.get("WEB_THREADS", "16")),
)
