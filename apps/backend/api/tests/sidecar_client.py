import io
import json
from urllib.parse import urlsplit

from service._web import JSON_MIMETYPE, App


def test_client(app: App) -> TestClient:
    return TestClient(app)


class TestResponse:
    def __init__(self, status_code: int, headers: dict[str, str], data: bytes) -> None:
        self.status_code = status_code
        self.headers = headers
        self.data = data

    def get_data(self, as_text: bool = False) -> bytes | str:
        return self.data.decode("utf-8") if as_text else self.data

    def get_json(self) -> object:
        mimetype = self.headers.get("Content-Type", "").split(";")[0]
        return json.loads(self.data) if mimetype == JSON_MIMETYPE else None

    @property
    def json(self) -> object:
        return self.get_json()


class TestClient:
    def __init__(self, app: App) -> None:
        self.app = app

    def open(
        self,
        method: str,
        path: str,
        body: object = None,
        data: bytes | str | None = None,
        content_type: str | None = None,
    ) -> TestResponse:
        if body is not None:
            data = json.dumps(body)
            content_type = content_type or JSON_MIMETYPE
        raw = data.encode("utf-8") if isinstance(data, str) else (data or b"")
        url = urlsplit(path)
        environ: dict[str, object] = {
            "REQUEST_METHOD": method,
            "PATH_INFO": url.path,
            "QUERY_STRING": url.query,
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw),
        }
        if content_type is not None:
            environ["CONTENT_TYPE"] = content_type
        response = self.app.respond(environ)
        body_bytes = (
            response.body
            if isinstance(response.body, bytes)
            else b"".join(response.body)
        )
        return TestResponse(response.status_code, dict(response.headers), body_bytes)

    def get(self, path: str) -> TestResponse:
        return self.open("GET", path)

    def post(
        self,
        path: str,
        json: object = None,
        data: bytes | str | None = None,
        content_type: str | None = None,
    ) -> TestResponse:
        return self.open("POST", path, json, data, content_type)

    def delete(self, path: str, json: object = None) -> TestResponse:
        return self.open("DELETE", path, json)
