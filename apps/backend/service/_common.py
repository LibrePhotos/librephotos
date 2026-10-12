"""What every sidecar shares: its Flask app, /health, the idle clock and serve().

The sidecars are small Flask apps started as ``python service/<name>/main.py``
(or ``python image_similarity/main.py``) by api.runtime.supervisor, which puts the
backend root on their PYTHONPATH, so this module imports as
``service._common`` there as in the tests and the standalone build.

``create_app(name)``
    The Flask app, with the parts that used to be copied into every main.py:

    * ``GET /health`` answers ``{"status": "OK", "service": ...,
      "last_request_time": ..., "model_loaded": ..., "busy": ...}`` with 200
      for every sidecar alike. ``last_request_time`` is stamped when any
      other request *starts*; ``busy`` says one is still running, so a
      minutes-long inference never looks idle. ``model_loaded`` is None for a
      sidecar that holds no model.
    * ``GET``/``POST /unload-model``, for a sidecar that passes ``unload``:
      the watchdog (api.runtime.supervisor.check_services) calls it once the sidecar has
      been idle for a while, to give the model's memory back without killing
      the process. It answers 409 while a request is running.
    * A request body that is not a JSON object with the required fields
      (``json_fields``) is answered with an empty 400, as every sidecar did,
      and an unexpected exception with ``{"error": "..."}`` and 500.

``serve_forever(app, name)``
    Serves the app with gevent on the port api.runtime.sidecars.SERVICES gives the
    sidecar, on loopback unless SERVICE_HOST says otherwise: the sidecars
    have no authentication, and the backend only ever calls them on
    127.0.0.1. Each main.py wraps it in the ``serve()`` the standalone build
    calls (librephotos.standalone.run_service).

``logger(name)``
    The sidecar's stdlib logger: the backend's line format and LOG_LEVEL (or
    its LOG_LEVELS entry), written to the stdout api.runtime.supervisor leaves the
    sidecar (see _service_environment), which is the container log, and
    nowhere else (logging_bootstrap.configure_standalone). Modules that must
    not import Flask take ``logging.getLogger(name)`` instead and log through
    the same handler. A sidecar never calls print().
"""

import gc
import logging
import sys
import time
from collections.abc import Callable
from typing import Any

from flask import Flask, request
from flask.typing import ResponseReturnValue
from werkzeug.exceptions import HTTPException

from librephotos.env import env_str
from librephotos.logging_bootstrap import configure_standalone, take_deferred

DEFAULT_HOST = "127.0.0.1"


class MalformedRequest(Exception):
    """The request body is not a JSON object with the fields the route needs."""


class _State:
    def __init__(self) -> None:
        self.last_request_time: float | None = None
        self.in_flight: int = 0


def logger(name: str) -> logging.Logger:
    return configure_standalone(name)


def create_app(
    name: str,
    unload: Callable[[], object] | None = None,
    is_loaded: Callable[[], object] | None = None,
) -> Flask:
    """The sidecar's Flask app.

    ``unload`` releases the models the sidecar holds (registers
    ``/unload-model``); ``is_loaded`` says whether any is held right now
    (reported by /health as ``model_loaded``).
    """
    app = Flask(name)
    state = _State()
    app.extensions["librephotos_sidecar"] = state
    log = logger(name)

    def counts(endpoint: str | None) -> bool:
        return endpoint not in ("health", "unload_model")

    @app.before_request
    def stamp_request_start() -> None:
        # At the start, not the end: a long inference is not idleness.
        if counts(request.endpoint):
            state.last_request_time = time.time()
            state.in_flight += 1

    @app.teardown_request
    def end_request(_error: BaseException | None) -> None:
        if counts(request.endpoint):
            state.in_flight -= 1

    @app.errorhandler(MalformedRequest)
    def malformed_request(error: MalformedRequest) -> ResponseReturnValue:
        log.warning("%s: malformed request: %s", name, error)
        return "", 400

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception) -> ResponseReturnValue:
        if isinstance(error, HTTPException):
            return error
        # JSON with the reason rather than Flask's HTML page: the backend
        # logs the "error" field of a failed reply.
        log.error("%s: error handling %s: %r", name, request.path, error)
        return {"error": f"{type(error).__name__}: {error}"}, 500

    @app.get("/health", strict_slashes=False)
    def health() -> ResponseReturnValue:
        return {
            "status": "OK",
            "service": name,
            "last_request_time": state.last_request_time,
            "model_loaded": None if is_loaded is None else bool(is_loaded()),
            "busy": state.in_flight > 0,
        }, 200

    if unload is not None:

        @app.route("/unload-model", methods=["GET", "POST"])
        def unload_model() -> ResponseReturnValue:
            if state.in_flight:
                # A request that started long ago may still be using it.
                return {"status": "busy"}, 409
            unload()
            release_memory()
            log.info("%s: model unloaded", name)
            return {"status": "OK"}, 200

    return app


def last_request_time(app: Flask) -> float | None:
    state: _State = app.extensions["librephotos_sidecar"]
    return state.last_request_time


def json_fields(*required: str, **optional: object) -> tuple[Any, ...]:
    """The request's JSON fields: *required* in order, then *optional* (with
    their defaults) in keyword order. Raises MalformedRequest (an empty 400)
    for a body that is not a JSON object or lacks a required field.

    The values are whatever the client sent, so they come back as ``Any``:
    each route narrows them where it uses them.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise MalformedRequest("the body is not a JSON object")
    missing = [key for key in required if key not in data]
    if missing:
        raise MalformedRequest(f"missing {', '.join(missing)}")
    values: list[Any] = [data[key] for key in required]
    values += [data.get(key, default) for key, default in optional.items()]
    return tuple(values)


def release_memory() -> None:
    """Hand freed memory back to the operating system.

    Dropping the last reference to an ONNX Runtime session frees its arena,
    but glibc keeps freed heap pages mapped until asked to trim them; without
    that the sidecar's resident size barely moves after an unload.
    """
    gc.collect()
    if sys.platform.startswith("linux"):
        try:
            import ctypes

            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except (OSError, AttributeError):
            # musl or another libc without malloc_trim.
            pass


def serve_forever(app: Flask, name: str) -> None:
    from gevent.pywsgi import WSGIServer

    from api.runtime.sidecars import SERVICES

    log = logger(name)
    # What the settings-free startup noticed before a handler existed, such
    # as an environment value librephotos.env could not read.
    for level, message in take_deferred():
        log.log(level, message)
    log.info("%s: service starting", name)
    host = env_str("SERVICE_HOST", DEFAULT_HOST)
    WSGIServer((host, SERVICES[name]), app).serve_forever()
