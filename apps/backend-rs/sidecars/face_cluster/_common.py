"""The sidecar conventions of apps/backend/service/_common.py, without Django.

The Rust backend starts this sidecar on its own, so it cannot import the
backend's copy (that one reads its port from api.sidecars). Same contract:

* ``GET /health`` answers ``{"status": "OK", "service", "last_request_time",
  "model_loaded", "busy"}`` with 200.
* ``GET``/``POST /unload-model`` releases memory, 409 while a request runs.
* A body that is not a JSON object with the required fields is an empty 400;
  an unexpected exception is ``{"error": "..."}`` with 500.
"""

import gc
import os
import sys
import time

from flask import Flask, request
from werkzeug.exceptions import HTTPException

DEFAULT_HOST = "127.0.0.1"


class MalformedRequest(Exception):
    """The request body is not a JSON object with the fields the route needs."""


class _State:
    def __init__(self):
        self.last_request_time = None
        self.in_flight = 0


def logger(name):
    def log(message):
        print(f"{name}: {message}", flush=True)

    return log


def create_app(name, unload=None, is_loaded=None):
    app = Flask(name)
    state = _State()
    app.extensions["librephotos_sidecar"] = state
    log = logger(name)

    def counts(endpoint):
        return endpoint not in ("health", "unload_model")

    @app.before_request
    def stamp_request_start():
        if counts(request.endpoint):
            state.last_request_time = time.time()
            state.in_flight += 1

    @app.teardown_request
    def end_request(_error):
        if counts(request.endpoint):
            state.in_flight -= 1

    @app.errorhandler(MalformedRequest)
    def malformed_request(error):
        log(f"malformed request: {error}")
        return "", 400

    @app.errorhandler(Exception)
    def unexpected_error(error):
        if isinstance(error, HTTPException):
            return error
        log(f"error handling {request.path}: {error!r}")
        return {"error": f"{type(error).__name__}: {error}"}, 500

    @app.get("/health", strict_slashes=False)
    def health():
        return {
            "status": "OK",
            "service": name,
            "last_request_time": state.last_request_time,
            "model_loaded": None if is_loaded is None else bool(is_loaded()),
            "busy": state.in_flight > 0,
        }, 200

    if unload is not None:

        @app.route("/unload-model", methods=["GET", "POST"])
        def unload_model():
            if state.in_flight:
                return {"status": "busy"}, 409
            unload()
            release_memory()
            log("model unloaded")
            return {"status": "OK"}, 200

    return app


def json_fields(*required, **optional):
    """The request's JSON fields: *required* in order, then *optional* (with
    their defaults) in keyword order. Raises MalformedRequest (an empty 400)
    for a body that is not a JSON object or lacks a required field.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise MalformedRequest("the body is not a JSON object")
    missing = [key for key in required if key not in data]
    if missing:
        raise MalformedRequest(f"missing {', '.join(missing)}")
    values = [data[key] for key in required]
    values += [data.get(key, default) for key, default in optional.items()]
    return tuple(values)


def release_memory():
    gc.collect()
    if sys.platform.startswith("linux"):
        try:
            import ctypes

            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except (OSError, AttributeError):
            pass


def serve_forever(app, name, default_port):
    """Serve on loopback (SERVICE_HOST overrides) at SERVICE_PORT or *default_port*."""
    host = os.environ.get("SERVICE_HOST", DEFAULT_HOST)
    port = int(os.environ.get("SERVICE_PORT", default_port))
    logger(name)(f"service starting on {host}:{port}")
    try:
        from gevent.pywsgi import WSGIServer
    except ImportError:
        app.run(host=host, port=port, threaded=False)
        return
    WSGIServer((host, port), app, log=None).serve_forever()
