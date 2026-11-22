import gc
import logging
import sys
import time
from collections.abc import Callable
from typing import Any

from librephotos.env import env_str
from librephotos.logging_bootstrap import configure_standalone, take_deferred
from service._web import App, ResponseReturnValue, request

DEFAULT_HOST = "127.0.0.1"


class MalformedRequest(Exception):
    """The request body is not a JSON object with the fields the route needs."""


class _State:
    def __init__(self) -> None:
        self.last_request_time: float | None = None
        self.in_flight: int = 0


def logger(name: str) -> logging.Logger:
    return configure_standalone(name)


def replica_index() -> int:
    from api.runtime.replicas import replica_argument

    return replica_argument(sys.argv)


def create_app(
    name: str,
    unload: Callable[[], object] | None = None,
    is_loaded: Callable[[], object] | None = None,
    device: Callable[[], str | None] | None = None,
) -> App:
    app = App(name)
    state = _State()
    app.extensions["librephotos_sidecar"] = state
    log = logger(name)
    replica = replica_index()

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
            "replica": replica,
            "device": None if device is None else device(),
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


def last_request_time(app: App) -> float | None:
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
        except OSError, AttributeError:
            # musl or another libc without malloc_trim.
            pass


def serve_forever(app: App, name: str) -> None:
    from api.runtime.replicas import replica_port
    from api.runtime.sidecars import SERVICES
    from service._wsgi_server import serve

    log = logger(name)
    # What the settings-free startup noticed before a handler existed, such
    # as an environment value librephotos.env could not read.
    for level, message in take_deferred():
        log.log(level, message)
    replica = replica_index()
    log.info("%s: service starting (replica %s)", name, replica)
    host = env_str("SERVICE_HOST", DEFAULT_HOST)
    serve((host, replica_port(SERVICES[name], replica)), app, log)
