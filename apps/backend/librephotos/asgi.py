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

from a2wsgi import WSGIMiddleware
from a2wsgi.wsgi import WSGIResponder

from librephotos.wsgi import application as wsgi_application


class ClientDisconnected(Exception):
    pass


class DisconnectAwareResponder(WSGIResponder):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.disconnected = False
        self._receive = None
        self._watcher = None

    async def __call__(self, scope, receive, send):
        self._receive = receive
        try:
            return await super().__call__(scope, receive, send)
        finally:
            if self._watcher is not None:
                self._watcher.cancel()

    async def _watch(self):
        # After the response has started the request body is done, so receive()
        # only has a disconnect left to deliver.
        while True:
            message = await self._receive()
            if message["type"] == "http.disconnect":
                self.disconnected = True
                return

    def start_response(self, status, response_headers, exc_info=None):
        write = super().start_response(status, response_headers, exc_info)
        if self._watcher is None:
            self._watcher = asyncio.run_coroutine_threadsafe(self._watch(), self.loop)
        return write

    def send(self, message):
        if self.disconnected:
            raise ClientDisconnected()
        super().send(message)

    def wsgi(self, environ, start_response):
        try:
            super().wsgi(environ, start_response)
        except ClientDisconnected:
            pass


class Middleware(WSGIMiddleware):
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            responder = DisconnectAwareResponder(
                self.app, self.executor, self.send_queue_size
            )
            return await responder(scope, receive, send)
        return await super().__call__(scope, receive, send)


# Concurrent requests per uvicorn worker; every one holds a thread while it runs.
application = Middleware(
    wsgi_application, workers=int(os.environ.get("WEB_THREADS", "16"))
)
