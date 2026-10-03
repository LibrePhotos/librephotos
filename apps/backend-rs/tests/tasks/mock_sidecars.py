"""Deterministic stand-ins for the ML sidecars and Nominatim, for the tasks
differential runs (tests/tasks/README.md). Django and Rust call the same
instance, so both get byte-identical answers.

    python mock_sidecars.py <port>

Answers depend only on the file's base name (both sides render the same
thumbnails under different media roots) or the request itself. With
MOCK_MANIFEST (the fixture's manifest.json) a similarity search answers with
some of the user's own photos instead of nothing.
"""

import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DIM = 512
TAGS = ["beach", "sunset", "dog", "mountain", "receipt", "city", "document", "menu"]
OCR_TEXTS = [
    "Coffee 3,50 €\nCake 4,20 €\nTOTAL 7,70 €",
    "hello world, this is a caption on a sign",
    "",
]


def base(path):
    return os.path.basename(str(path).replace("\\", "/"))


def seed(text):
    return int(hashlib.md5(text.encode("utf-8")).hexdigest()[:12], 16)


def vector(key, dim=DIM):
    s = seed(key)
    out = []
    for i in range(dim):
        s = (s * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        out.append(round(((s >> 11) % 20001) / 10000.0 - 1.0, 6))
    return out


def image_size(path):
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return (100, 100)


def face_locations(source):
    name = base(source)
    w, h = image_size(source)
    n = seed(name) % 3
    fw, fh = max(w // 5, 2), max(h // 5, 2)
    boxes = []
    for i in range(n):
        left = w // 10 if i == 0 else w // 2
        top = h // 4
        boxes.append([top, left + fw, top + fh, left])
    reply = {"face_locations": boxes}
    if seed(name) % 5 != 0:
        reply["encodings"] = [vector(f"{name}#{i}") for i in range(n)]
    return reply


_owned = None


def owned_hashes(user_id):
    """The image hashes of `user_id`'s photos in MOCK_MANIFEST, sorted."""
    global _owned
    if _owned is None:
        _owned = {}
        path = os.environ.get("MOCK_MANIFEST")
        if path:
            with open(path, encoding="utf-8") as fh:
                m = json.load(fh)
            ids = {u["username"]: u["id"] for u in m["users"].values()}
            for p in m["photos"].values():
                _owned.setdefault(ids[p["owner"]], []).append(p["image_hash"])
            for hashes in _owned.values():
                hashes.sort()
    return _owned.get(user_id, [])


def similar(body):
    """A few of the user's photos, picked by the request (not the embedding:
    Django and Rust serialize the same float32 values differently)."""
    user_id = body.get("user_id")
    n = min(int(body.get("n") or 6), 6)
    s = f"{user_id}:{body.get('n')}:{body.get('threshold')}"
    return sorted(owned_hashes(user_id), key=lambda h: seed(f"{s}:{h}"))[:n]


def reverse(lat, lon):
    city, country = ("Berlin", "Deutschland") if lat > 45 else ("Tokyo", "Japan")
    return {
        "lat": str(lat),
        "lon": str(lon),
        "display_name": f"Mock Street 1, {city}, {country}",
        "address": {
            "road": "Mock Street",
            "house_number": "1",
            "suburb": "12345",
            "city": city,
            "state": city,
            "country": country,
            "postcode": "10117",
        },
    }


def answer(method, path, query, body):
    if path == "/health":
        return 200, {"status": "OK", "service": "mock", "busy": False}
    if path == "/unload-model":
        return 200, {"status": "OK"}
    if path == "/face-locations":
        return 200, face_locations(body["source"])
    if path == "/face-encodings":
        name = base(body["source"])
        return 200, {
            "encodings": [
                vector(f"{name}@{list(loc)}") for loc in body["face_locations"]
            ]
        }
    if path == "/clip-embeddings":
        embs, mags = [], []
        for img in body["imgs"]:
            name = base(img)
            if seed(name) % 7 == 0:
                embs.append(None)
                mags.append(None)
                continue
            v = vector(name)
            embs.append(v)
            mags.append(sum(x * x for x in v) ** 0.5)
        return 200, {"imgs_emb": embs, "magnitudes": mags}
    if path == "/query-embeddings":
        v = vector(f"query:{body.get('query')}")
        return 200, {"emb": v, "magnitude": sum(x * x for x in v) ** 0.5}
    if path == "/generate-tags":
        s = seed(base(body["image_path"]))
        tags = [TAGS[s % len(TAGS)], TAGS[(s // 7 + 1) % len(TAGS)]]
        if tags[0] == tags[1]:
            tags = tags[:1]
        return 200, {"tags": {"tags": tags}}
    if path == "/ocr":
        name = base(body["image_path"])
        text = OCR_TEXTS[seed(name) % len(OCR_TEXTS)]
        return 200, {
            "text": text,
            "blocks": [{"text": text, "box": [[0, 0], [10, 0], [10, 5], [0, 5]], "confidence": 0.9}],
            "image_width": 640,
            "image_height": 480,
            "mean_confidence": 0.91,
            "text_area_fraction": 0.25 if len(text) > 20 else 0.01,
        }
    if path == "/generate-caption":
        prompt = body.get("prompt") or ""
        digest = hashlib.md5(prompt.encode("utf-8")).hexdigest()[:8]
        return 200, {"caption": f"<start> a photo of {base(body['image_path'])} [{digest}] <end> "}
    if path == "/build/":
        if method == "DELETE":
            return 200, {"status": True}
        return 200, {"status": True, "index_size": len(body.get("image_hashes", []))}
    if path == "/search/":
        return 200, {"status": True, "result": similar(body)}
    if path == "/reverse":
        return 200, reverse(float(query["lat"][0]), float(query["lon"][0]))
    if path == "/search":
        return 200, [{"display_name": "Mock Place", "lat": "1.5", "lon": "2.5"}]
    return 404, {"error": f"mock has no {path}"}


class Handler(BaseHTTPRequestHandler):
    def _serve(self, method):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            body = {}
        status, reply = answer(method, url.path, parse_qs(url.query), body)
        data = json.dumps(reply).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        if os.environ.get("MOCK_LOG"):
            with open(os.environ["MOCK_LOG"], "a", encoding="utf-8") as log:
                log.write(json.dumps({"method": method, "path": url.path, "body": body}) + "\n")

    def do_GET(self):
        self._serve("GET")

    def do_POST(self):
        self._serve("POST")

    def do_DELETE(self):
        self._serve("DELETE")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1])
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
