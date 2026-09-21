"""The ASGI entry point streams sync responses and stops them when the client leaves."""

import asyncio
import unittest

from librephotos.asgi import Middleware


def _scope():
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/stream",
        "raw_path": b"/stream",
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "client": ("127.0.0.1", 1234),
        "server": ("127.0.0.1", 8000),
    }


class _Producer:
    """A WSGI iterable that would run forever unless closed."""

    def __init__(self):
        self.produced = 0
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        self.produced += 1
        return b"x" * 1024

    def close(self):
        self.closed = True


def _app(producer):
    def app(environ, start_response):
        start_response("200 OK", [("Content-Type", "application/octet-stream")])
        return producer

    return app


class DisconnectTests(unittest.TestCase):
    def test_client_disconnect_closes_the_iterable(self):
        producer = _Producer()
        sent = []

        async def run():
            messages = [{"type": "http.request", "body": b"", "more_body": False}]

            async def receive():
                if messages:
                    return messages.pop(0)
                # Pretend the viewer closed the tab once a few chunks went out.
                while len(sent) < 5:
                    await asyncio.sleep(0.01)
                return {"type": "http.disconnect"}

            async def send(message):
                sent.append(message)

            await asyncio.wait_for(
                Middleware(_app(producer), workers=2)(_scope(), receive, send), 10
            )

        asyncio.run(run())
        self.assertTrue(producer.closed)
        self.assertLess(producer.produced, 100_000)
        self.assertEqual(sent[0]["type"], "http.response.start")

    def test_streams_chunks_before_the_iterable_finishes(self):
        chunks = [b"a", b"b", b"c"]
        seen_before_end = []

        def app(environ, start_response):
            start_response("200 OK", [])

            def gen():
                for chunk in chunks:
                    yield chunk
                    seen_before_end.append(len(sent_bodies))

            return gen()

        sent_bodies = []

        async def run():
            messages = [{"type": "http.request", "body": b"", "more_body": False}]

            async def receive():
                if messages:
                    return messages.pop(0)
                await asyncio.sleep(3600)

            async def send(message):
                if message["type"] == "http.response.body" and message["body"]:
                    sent_bodies.append(message["body"])
                    await asyncio.sleep(0.02)

            await asyncio.wait_for(
                Middleware(app, workers=2)(_scope(), receive, send), 10
            )

        asyncio.run(run())
        self.assertEqual(sent_bodies, chunks)
        # the first chunk had been handed to the server before the last was produced
        self.assertGreater(seen_before_end[-1], 0)
