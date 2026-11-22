from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from contextvars import ContextVar
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from _typeshed.wsgi import StartResponse, WSGIEnvironment

JSON_MIMETYPE = "application/json"
TEXT_MIMETYPE = "text/html; charset=utf-8"

type Body = dict[str, Any] | list[Any] | str | bytes
type ResponseReturnValue = Response | Body | tuple[Response | Body, int]
type View = Callable[[], ResponseReturnValue]
type ErrorAnswer = Callable[[Exception], ResponseReturnValue | None]


class Response:
    def __init__(
        self,
        body: bytes | str | Iterable[bytes] = b"",
        status: int = 200,
        mimetype: str = TEXT_MIMETYPE,
    ) -> None:
        self.status_code = status
        self.headers: list[tuple[str, str]] = [("Content-Type", mimetype)]
        self.body = body.encode("utf-8") if isinstance(body, str) else body


def json_response(value: object, status: int = 200) -> Response:
    return Response(json.dumps(value).encode("utf-8") + b"\n", status, JSON_MIMETYPE)


def _as_response(value: ResponseReturnValue) -> Response:
    status: int | None = None
    if isinstance(value, tuple):
        value, status = value
    if isinstance(value, Response):
        response = value
    elif isinstance(value, dict | list):
        response = json_response(value)
    else:
        response = Response(value)
    if status is not None:
        response.status_code = status
    return response


class Request:
    def __init__(self, environ: WSGIEnvironment, endpoint: str | None) -> None:
        self.environ = environ
        self.method = str(environ["REQUEST_METHOD"]).upper()
        self.path = str(environ.get("PATH_INFO") or "/")
        self.endpoint = endpoint
        self._data: bytes | None = None

    @property
    def mimetype(self) -> str:
        content_type = str(self.environ.get("CONTENT_TYPE", ""))
        return content_type.split(";", maxsplit=1)[0].strip().lower()

    def get_data(self) -> bytes:
        if self._data is None:
            stream = self.environ["wsgi.input"]
            length = self.environ.get("CONTENT_LENGTH")
            self._data = stream.read(int(length)) if length else stream.read()
        return self._data

    def get_json(self, silent: bool = False) -> object:
        mimetype = self.mimetype
        is_json = mimetype == JSON_MIMETYPE or (
            mimetype.startswith("application/") and mimetype.endswith("+json")
        )
        try:
            if not is_json:
                raise ValueError("the request body is not JSON")
            return json.loads(self.get_data())
        except ValueError:
            if silent:
                return None
            raise


_current: ContextVar[Request] = ContextVar("sidecar_request")


class CurrentRequest:
    @property
    def method(self) -> str:
        return _current.get().method

    @property
    def path(self) -> str:
        return _current.get().path

    @property
    def endpoint(self) -> str | None:
        return _current.get().endpoint

    def get_data(self) -> bytes:
        return _current.get().get_data()

    def get_json(self, silent: bool = False) -> object:
        return _current.get().get_json(silent)


request = CurrentRequest()


class _Route:
    def __init__(self, view: View, methods: frozenset[str]) -> None:
        self.view = view
        self.endpoint = view.__name__
        self.methods = methods


class App:
    def __init__(self, name: str) -> None:
        self.name = name
        self.config: dict[str, object] = {}
        self.extensions: dict[str, Any] = {}
        self._routes: dict[str, list[_Route]] = {}
        self._before: list[Callable[[], object]] = []
        self._teardown: list[Callable[[BaseException | None], object]] = []
        self._error_answers: list[ErrorAnswer] = []

    def route(
        self,
        path: str,
        methods: Iterable[str] = ("GET",),
        strict_slashes: bool = True,
    ) -> Callable[[View], View]:
        allowed = frozenset(method.upper() for method in methods)
        if "GET" in allowed:
            allowed |= {"HEAD"}

        def register(view: View) -> View:
            route = _Route(view, allowed)
            paths = {path}
            if not strict_slashes:
                paths.add(path.rstrip("/") + "/")
            for each in paths:
                self._routes.setdefault(each, []).append(route)
            return view

        return register

    def get(self, path: str, strict_slashes: bool = True) -> Callable[[View], View]:
        return self.route(path, ("GET",), strict_slashes)

    def post(self, path: str) -> Callable[[View], View]:
        return self.route(path, ("POST",))

    def before_request(self, hook: Callable[[], object]) -> Callable[[], object]:
        self._before.append(hook)
        return hook

    def teardown_request(
        self, hook: Callable[[BaseException | None], object]
    ) -> Callable[[BaseException | None], object]:
        self._teardown.append(hook)
        return hook

    def errorhandler[E: Exception](
        self, kind: type[E]
    ) -> Callable[
        [Callable[[E], ResponseReturnValue]], Callable[[E], ResponseReturnValue]
    ]:
        def register(
            handler: Callable[[E], ResponseReturnValue],
        ) -> Callable[[E], ResponseReturnValue]:
            def answer(error: Exception) -> ResponseReturnValue | None:
                return handler(error) if isinstance(error, kind) else None

            self._error_answers.append(answer)
            return handler

        return register

    def _route_for(self, method: str, path: str) -> _Route | Response:
        routes = self._routes.get(path)
        if not routes:
            if not path.endswith("/") and path + "/" in self._routes:
                moved = Response(b"", 308)
                moved.headers.append(("Location", path + "/"))
                return moved
            return Response(b"Not Found", 404)
        for route in routes:
            if method in route.methods:
                return route
        return Response(b"Method Not Allowed", 405)

    def _answer(self, error: Exception) -> Response | None:
        for answer in self._error_answers:
            answered = answer(error)
            if answered is not None:
                return _as_response(answered)
        return None

    def respond(self, environ: WSGIEnvironment) -> Response:
        method = str(environ["REQUEST_METHOD"]).upper()
        found = self._route_for(method, str(environ.get("PATH_INFO") or "/"))
        endpoint = found.endpoint if isinstance(found, _Route) else None
        token = _current.set(Request(environ, endpoint))
        failure: Exception | None = None
        try:
            try:
                for hook in self._before:
                    hook()
                if isinstance(found, Response):
                    return found
                return _as_response(found.view())
            except Exception as error:
                failure = error
                answered = self._answer(error)
                if answered is None:
                    raise
                return answered
        finally:
            for teardown in self._teardown:
                teardown(failure)
            _current.reset(token)

    def __call__(
        self, environ: WSGIEnvironment, start_response: StartResponse
    ) -> Iterable[bytes]:
        response = self.respond(environ)
        headers = list(response.headers)
        if isinstance(response.body, bytes):
            headers.append(("Content-Length", str(len(response.body))))
        status = HTTPStatus(response.status_code)
        start_response(f"{status.value} {status.phrase}", headers)
        if environ["REQUEST_METHOD"] == "HEAD":
            return []
        return [response.body] if isinstance(response.body, bytes) else response.body
