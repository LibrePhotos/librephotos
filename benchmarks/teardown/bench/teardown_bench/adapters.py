"""One adapter per app: the API calls a user's clicks would make, against the pinned release.

Endpoints were read from each release's source (commit in tools.json), not from docs.
None of them has been sent to a live server yet; README.md lists what is verified.
"""

from __future__ import annotations

import base64
import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from .client import Client, HttpError

PASSWORD = "teardown-Bench-2026"  # local throwaway stacks only
EMAIL = "bench@example.com"


@dataclass
class PhotoRef:
    id: str
    host_path: Path
    app_path: str


@dataclass
class WriteBackMode:
    """A setting a user can switch on to get edits into files."""

    label: str
    setting: str
    enable: Callable[[], None]
    # Write the faces the app already knows into the files, when the app has such an action.
    write_faces: Callable[[], None] | None = None


class Adapter:
    name = "?"
    base_url = ""
    container_root = "/data"  # where the dataset's library folder appears inside the app

    def __init__(self, work: Path) -> None:
        self.work = work
        self.library = work / "library"
        self.api = Client(self.base_url)
        self.steps: list[str] = []
        self.notes: list[str] = []
        self._catalog: dict[str, PhotoRef] | None = None

    # -- lifecycle --------------------------------------------------------------------
    def ready(self) -> bool:
        raise NotImplementedError

    def bootstrap(self) -> None:
        raise NotImplementedError

    def start_index(self) -> None:
        raise NotImplementedError

    def busy(self) -> tuple[bool, dict[str, Any]]:
        """Is the app still indexing? ``(busy, detail)`` from the app's own job API."""
        raise NotImplementedError

    def counts(self) -> dict[str, Any]:
        raise NotImplementedError

    # -- finding and reading photos ----------------------------------------------------
    def find(self, relative: str) -> PhotoRef | None:
        """The app's photo for a library-relative path (listing read once, then cached)."""
        if self._catalog is None:
            self._catalog = self.catalog()
        return self._catalog.get(relative)

    def catalog(self) -> dict[str, PhotoRef]:
        raise NotImplementedError

    def detail(self, ref: PhotoRef) -> Any:
        """Everything the app's API says about one photo (searched by value for the interop score)."""
        raise NotImplementedError

    def lists(self) -> Any:
        """App-wide lists (tags, people) also searched by value."""
        return {}

    def faces(self, ref: PhotoRef, detail: Any) -> list[dict[str, Any]]:
        """``[{"name": str, "box": bool}]`` for the photo's faces."""
        return []

    def rating(self, detail: Any) -> int | None:
        return None

    # -- edits, write-back, export, delete ------------------------------------------------
    def set_metadata(self, ref: PhotoRef, rating: int, description: str, keyword: str) -> dict[str, str]:
        raise NotImplementedError

    def write_back_modes(self) -> list[WriteBackMode]:
        """Settings that switch write-back on; empty when the app has none (or it is always on)."""
        return []

    def name_faces(self, relatives: list[str]) -> int:
        """Name the detected faces of these photos, as a user does before writing face tags; returns how many."""
        return 0

    def app_sidecars(self, ref: PhotoRef) -> list[Path]:
        """The app's own (non-XMP) sidecar files for a photo, if it keeps any."""
        return []

    def export(self, refs: list[PhotoRef]) -> bytes:
        raise NotImplementedError

    def trash(self, ref: PhotoRef) -> None:
        raise NotImplementedError

    def purge(self, ref: PhotoRef) -> None:
        """Delete permanently from the trash (Empty trash / Delete permanently)."""
        raise NotImplementedError

    def trash_policy(self) -> dict[str, Any]:
        """The configured automatic trash expiry, read from the running app."""
        return {}

    # -- helpers -------------------------------------------------------------------------
    def host_path(self, app_path: str) -> Path:
        relative = PurePosixPath(app_path).relative_to(self.container_root)
        return self.library / Path(*relative.parts)

    def relative(self, app_path: str) -> str | None:
        try:
            return PurePosixPath(app_path).relative_to(self.container_root).as_posix()
        except ValueError:
            return None

    def step(self, text: str) -> None:
        self.steps.append(text)


def _jwt_claims(token: str) -> dict[str, Any]:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


class LibrePhotos(Adapter):
    """LibrePhotos 1.3.0 behind its proxy (port 3000)."""

    name = "librephotos"
    base_url = "http://localhost:3000"
    container_root = "/data"

    def __init__(self, work: Path) -> None:
        super().__init__(work)
        self.user_id: int | None = None
        self.api.relogin = self.login

    def ready(self) -> bool:
        status, _body, _headers = self.api.raw("GET", "/api/healthz/ready", retry_auth=False)
        return status == 200

    def login(self) -> None:
        # An expired bearer header makes simplejwt answer 401 even on the login view.
        self.api.headers.pop("Authorization", None)
        tokens = self.api.post("/api/auth/token/obtain/", {"username": "admin", "password": PASSWORD})
        self.api.headers["Authorization"] = f"Bearer {tokens['access']}"
        self.user_id = _jwt_claims(tokens["access"]).get("user_id")

    def bootstrap(self) -> None:
        # The admin comes from ADMIN_USERNAME/ADMIN_PASSWORD (compose env), the documented
        # unattended equivalent of the first-time setup wizard.
        self.login()
        self.step("log in as the admin created from the compose env")
        self.api.json("PATCH", f"/api/manage/user/{self.user_id}/", {"scan_directory": "/data"})
        self.step("set the admin's scan directory to /data")

    def start_index(self) -> None:
        try:
            self.api.post("/api/scanphotos/")
        except HttpError as error:
            if error.status != 405:
                raise
            self.api.get("/api/scanphotos/")
        self.step("start 'Scan photos'")

    def busy(self) -> tuple[bool, dict[str, Any]]:
        jobs = self.api.get("/api/jobs/", page_size=100)
        rows = jobs.get("results", jobs) if isinstance(jobs, dict) else jobs
        running = [j.get("job_type_str") for j in rows if not j.get("finished")]
        queue = self.api.get("/api/rqavailable/")
        free = bool(queue.get("queue_can_accept_job", True)) if isinstance(queue, dict) else True
        return bool(running) or not free, {"unfinished_jobs": running, "queue_free": free}

    def counts(self) -> dict[str, Any]:
        stats = self.api.get("/api/stats/")
        return {"total": stats.get("num_photos"), "raw": stats}

    def catalog(self) -> dict[str, PhotoRef]:
        found: dict[str, PhotoRef] = {}
        page_url: str | None = "/api/photos/?page_size=1000"
        try:
            while page_url:  # the photo list carries image_path for every file of a photo
                page = self.api.get(page_url)
                rows = page.get("results", []) if isinstance(page, dict) else page
                for row in rows:
                    for path in row.get("image_path") or []:
                        relative = self.relative(path)
                        if relative:
                            found[relative] = PhotoRef(row["image_hash"], self.host_path(path), path)
                page_url = page.get("next") if isinstance(page, dict) else None
        except HttpError:
            self.notes.append("photo list has no image_path; fell back to one detail call per photo")
        if not found:
            recent = self.api.get("/api/photos/recentlyadded/") or {}
            for row in recent.get("results", []):
                for path in self.api.get(f"/api/photos/{row['image_hash']}/").get("image_path") or []:
                    relative = self.relative(path)
                    if relative:
                        found[relative] = PhotoRef(row["image_hash"], self.host_path(path), path)
        return found

    def detail(self, ref: PhotoRef) -> Any:
        detail = self.api.get(f"/api/photos/{ref.id}/")
        # dev (1.4.0) adds a metadata view with keywords, title, creator...; absent on 1.3.0.
        try:
            detail["_metadata"] = self.api.get(f"/api/photos/{detail.get('id', ref.id)}/metadata/")
        except HttpError:
            pass
        return detail

    def lists(self) -> Any:
        return {"tags": self.api.get("/api/tags/", page_size=1000)}

    def faces(self, ref: PhotoRef, detail: Any) -> list[dict[str, Any]]:
        return [{"name": p.get("name") or "", "box": True} for p in detail.get("people") or []]

    def rating(self, detail: Any) -> int | None:
        return detail.get("rating")

    def set_metadata(self, ref: PhotoRef, rating: int, description: str, keyword: str) -> dict[str, str]:
        result = {}
        result["rating"] = _attempt(lambda: self.api.post(
            "/api/photosedit/rating/", {"image_hashes": [ref.id], "rating": rating}))
        result["description"] = _attempt(lambda: self.api.post(
            "/api/photosedit/savecaption/", {"image_hash": ref.id, "caption": description}))

        def tag() -> None:
            created = self.api.post("/api/tags/", {"name": keyword})
            self.api.post(f"/api/tags/{created['id']}/add/", {"photos": [ref.id]})

        result["keyword"] = _attempt(tag)
        return result

    def write_back_modes(self) -> list[WriteBackMode]:
        def setting(mode: str) -> Callable[[], None]:
            return lambda: self.api.json("PATCH", f"/api/user/{self.user_id}/",
                                         {"save_metadata_to_disk": mode, "save_face_tags_to_disk": True})

        return [
            WriteBackMode("opt-in-sidecar", "save_metadata_to_disk=SIDECAR_FILE, save_face_tags_to_disk=true",
                          setting("SIDECAR_FILE"), self.write_faces),
            WriteBackMode("opt-in-media", "save_metadata_to_disk=MEDIA_FILE, save_face_tags_to_disk=true",
                          setting("MEDIA_FILE"), self.write_faces),
        ]

    def name_faces(self, relatives: list[str]) -> int:
        # Face tags carry only names a user gave (1.3.0 writes nothing else, dev writes unnamed boxes).
        named = 0
        for number, relative in enumerate(relatives, start=1):
            ref = self.find(relative)
            if ref is None:
                continue
            face_ids = [p["face_id"] for p in self.api.get(f"/api/photos/{ref.id}/").get("people") or []
                        if p.get("face_id") is not None]
            if face_ids:
                self.api.post("/api/labelfaces/", {"face_ids": face_ids, "person_name": f"Bench Person {number}"})
                named += len(face_ids)
        if named:
            self.step("name the people in the photos (People > face > name)")
        return named

    def write_faces(self) -> None:
        """Settings > "Write metadata to files" for face tags (1.3.0 runs it in the request, dev queues a job)."""
        self.api.post("/api/savemetadata/", {"types": ["face_tags"]})
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and self.busy()[0]:
            time.sleep(3)

    def export(self, refs: list[PhotoRef]) -> bytes:
        job = self.api.post("/api/photos/download", {"image_hashes": [r.id for r in refs]})
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            # The same endpoint reports the job: 202 PENDING, then 200 SUCCESS or FAILURE. No trailing
            # slash, as the web client calls it: with one, CI run 2 got a 404 for a job that existed.
            state = (self.api.get("/api/photos/download", job_id=job["job_id"]) or {}).get("status")
            if state == "FAILURE":
                raise RuntimeError(f"zip download job {job['job_id']} failed")
            if state == "SUCCESS":
                break
            time.sleep(2)
        _status, body, _headers = self.api.raw("GET", f"/media/zip/{job['url']}")
        return body

    def trash(self, ref: PhotoRef) -> None:
        self.api.post("/api/photosedit/setdeleted/", {"image_hashes": [ref.id], "deleted": True})

    def purge(self, ref: PhotoRef) -> None:
        self.api.json("DELETE", "/api/photosedit/delete/", {"image_hashes": [ref.id]})

    def trash_policy(self) -> dict[str, Any]:
        settings = self.api.get("/api/sitesettings/") or {}
        days = settings.get("trash_retention_days")
        if days is None:
            return {"auto_expiry": False, "note": "no trash retention setting in this release"}
        return {"auto_expiry": bool(days), "days": days, "deletes_originals_on_expiry": True}


class LibrePhotosDev(LibrePhotos):
    """LibrePhotos dev image (1.4.0 to be): same API surface, more write-back."""

    name = "librephotos-dev"


class Immich(Adapter):
    """Immich v3.3.3; the dataset is an external library mounted at /mnt/library."""

    name = "immich"
    base_url = "http://localhost:2283"
    container_root = "/mnt/library"

    def __init__(self, work: Path) -> None:
        super().__init__(work)
        self.library_id = ""
        self.api.relogin = self.login

    def ready(self) -> bool:
        return (self.api.get("/api/server/ping") or {}).get("res") == "pong"

    def login(self) -> None:
        self.api.headers.pop("Authorization", None)
        session = self.api.post("/api/auth/login", {"email": EMAIL, "password": PASSWORD})
        self.api.headers["Authorization"] = f"Bearer {session['accessToken']}"

    def bootstrap(self) -> None:
        self.api.post("/api/auth/admin-sign-up", {"email": EMAIL, "password": PASSWORD, "name": "bench"})
        self.step("create the admin account (first-run sign-up)")
        self.login()
        me = self.api.get("/api/users/me")
        library = self.api.post("/api/libraries", {"ownerId": me["id"], "name": "teardown",
                                                   "importPaths": [self.container_root]})
        self.library_id = library["id"]
        self.step("create an external library with import path /mnt/library")

    def start_index(self) -> None:
        self.api.post(f"/api/libraries/{self.library_id}/scan")
        self.step("scan the external library")

    def busy(self) -> tuple[bool, dict[str, Any]]:
        pending = {}
        for queue in self.api.get("/api/queues") or []:
            stats = queue.get("statistics") or {}
            count = sum(int(stats.get(k) or 0) for k in ("active", "waiting", "delayed"))
            if count:
                pending[queue.get("name")] = count
        return bool(pending), {"pending": pending}

    def counts(self) -> dict[str, Any]:
        stats = self.api.get("/api/assets/statistics")
        return {"total": stats.get("total"), "images": stats.get("images"), "videos": stats.get("videos"),
                "raw": stats}

    def catalog(self) -> dict[str, PhotoRef]:
        found: dict[str, PhotoRef] = {}
        for page in range(1, 50):
            result = self.api.post("/api/search/metadata", {"libraryId": self.library_id, "page": page,
                                                             "size": 1000}) or {}
            assets = result.get("assets") or {}
            for item in assets.get("items", []):
                relative = self.relative(item.get("originalPath", ""))
                if relative:
                    found[relative] = PhotoRef(item["id"], self.host_path(item["originalPath"]),
                                               item["originalPath"])
            if not assets.get("nextPage"):
                break
        return found

    def detail(self, ref: PhotoRef) -> Any:
        return self.api.get(f"/api/assets/{ref.id}")

    def lists(self) -> Any:
        return {"tags": self.api.get("/api/tags"), "people": self.api.get("/api/people", size=1000)}

    def faces(self, ref: PhotoRef, detail: Any) -> list[dict[str, Any]]:
        faces = self.api.get("/api/faces", id=ref.id) or []
        return [{"name": ((f.get("person") or {}).get("name") or ""),
                 "box": f.get("boundingBoxX2") is not None} for f in faces]

    def rating(self, detail: Any) -> int | None:
        return (detail.get("exifInfo") or {}).get("rating")

    def set_metadata(self, ref: PhotoRef, rating: int, description: str, keyword: str) -> dict[str, str]:
        result = {}
        result["rating"] = _attempt(lambda: self.api.json("PUT", "/api/assets", {"ids": [ref.id], "rating": rating}))
        result["description"] = _attempt(lambda: self.api.json(
            "PUT", "/api/assets", {"ids": [ref.id], "description": description}))

        def tag() -> None:
            tags = self.api.json("PUT", "/api/tags", {"tags": [keyword]})
            self.api.json("PUT", f"/api/tags/{tags[0]['id']}/assets", {"ids": [ref.id]})

        result["keyword"] = _attempt(tag)
        return result

    # Write-back to XMP sidecars is always on in Immich: no switch, so no opt-in mode.

    def export(self, refs: list[PhotoRef]) -> bytes:
        _status, body, _headers = self.api.raw("POST", "/api/download/archive",
                                               {"assetIds": [r.id for r in refs]},
                                               headers={"Accept": "application/octet-stream"})
        return body

    def trash(self, ref: PhotoRef) -> None:
        self.api.json("DELETE", "/api/assets", {"ids": [ref.id], "force": False})

    def purge(self, ref: PhotoRef) -> None:
        self.api.post("/api/trash/empty")

    def trash_policy(self) -> dict[str, Any]:
        config = self.api.get("/api/admin/config") or {}
        trash = config.get("trash") or {}
        faces = ((config.get("metadata") or {}).get("faces") or {}).get("import")
        return {"auto_expiry": bool(trash.get("enabled")), "days": trash.get("days"),
                "deletes_originals_on_expiry": True, "face_import_from_files": faces}


class PhotoPrism(Adapter):
    """PhotoPrism 261007 (default image, not -ce); originals at /photoprism/originals."""

    name = "photoprism"
    base_url = "http://localhost:2342"
    container_root = "/photoprism/originals"

    def __init__(self, work: Path) -> None:
        super().__init__(work)
        self.download_token = ""
        self.index_thread: threading.Thread | None = None
        self.index_error: str | None = None
        self.api.relogin = self.login

    def ready(self) -> bool:
        # PHOTOPRISM_DEFAULT_TLS may answer with a self-signed certificate instead of plain HTTP.
        for base in (self.base_url, self.base_url.replace("http://", "https://")):
            self.api.base_url = base
            try:
                status = self.api.get("/api/v1/status")
            except (OSError, HttpError):
                continue
            if isinstance(status, dict) and status.get("status") == "operational":
                return True
        return False

    def login(self) -> None:
        self.api.headers.pop("Authorization", None)
        self.api.headers.pop("X-Auth-Token", None)
        # Upstream compose's own default admin (PHOTOPRISM_ADMIN_USER/PASSWORD), left as shipped.
        session = self.api.post("/api/v1/session", {"username": "admin", "password": "insecure"})
        token = session.get("access_token") or session.get("id")
        self.api.headers["Authorization"] = f"Bearer {token}"
        self.api.headers["X-Auth-Token"] = token
        self.download_token = ((session.get("config") or {}).get("downloadToken")) or ""

    def bootstrap(self) -> None:
        self.login()
        self.step("log in as the admin the upstream compose creates (admin/insecure)")

    def start_index(self) -> None:
        # POST /api/v1/index answers when indexing is done, so it runs in a thread.
        def run() -> None:
            client = Client(self.api.base_url, timeout=3600)
            client.headers = dict(self.api.headers)
            try:
                client.post("/api/v1/index", {"path": "/", "rescan": False, "cleanup": False})
            except Exception as error:  # noqa: BLE001 - reported in the result
                self.index_error = str(error)

        self.index_thread = threading.Thread(target=run, daemon=True)
        self.index_thread.start()
        self.step("Library > Index > Start")

    def busy(self) -> tuple[bool, dict[str, Any]]:
        alive = bool(self.index_thread and self.index_thread.is_alive())
        # Face clustering and other workers run after the index request; the caller also
        # waits for the CPU to settle (stats.quiet) for every app.
        return alive, {"index_request_running": alive, "index_error": self.index_error}

    def counts(self) -> dict[str, Any]:
        config = self.api.get("/api/v1/config")
        count = (config or {}).get("count", {})
        return {"total": (count.get("photos") or 0) + (count.get("videos") or 0) + (count.get("live") or 0),
                "images": count.get("photos"), "videos": count.get("videos"), "raw": count}

    def catalog(self) -> dict[str, PhotoRef]:
        found: dict[str, PhotoRef] = {}
        for offset in range(0, 20000, 500):
            rows = self.api.get("/api/v1/photos", count=500, offset=offset, merged="true") or []
            for row in rows:
                names = [row.get("FileName")] + [f.get("Name") for f in row.get("Files") or []]
                for name in filter(None, names):
                    app_path = f"{self.container_root}/{name}"
                    found[name] = PhotoRef(row["UID"], self.host_path(app_path), app_path)
            if len(rows) < 500:
                break
        return found

    def detail(self, ref: PhotoRef) -> Any:
        return self.api.get(f"/api/v1/photos/{ref.id}")

    def lists(self) -> Any:
        return {"labels": self.api.get("/api/v1/labels", count=1000, all="true"),
                "subjects": self.api.get("/api/v1/subjects", count=1000, type="person")}

    def faces(self, ref: PhotoRef, detail: Any) -> list[dict[str, Any]]:
        markers = [m for f in detail.get("Files") or [] for m in f.get("Markers") or []]
        return [{"name": m.get("Name") or "", "box": m.get("W") is not None}
                for m in markers if m.get("Type") in (None, "face")]

    def set_metadata(self, ref: PhotoRef, rating: int, description: str, keyword: str) -> dict[str, str]:
        result = {"rating": "unsupported: PhotoPrism has no star rating (Favorite only)"}
        result["description"] = _attempt(lambda: self.api.json(
            "PUT", f"/api/v1/photos/{ref.id}", {"Description": description, "DescriptionSrc": "manual"}))
        result["keyword"] = _attempt(lambda: self.api.json(
            "PUT", f"/api/v1/photos/{ref.id}", {"Details": {"Keywords": keyword, "KeywordsSrc": "manual"}}))
        return result

    # PhotoPrism writes its YAML sidecars by default and has no XMP write-back to switch on.

    def app_sidecars(self, ref: PhotoRef) -> list[Path]:
        relative = PurePosixPath(ref.app_path).relative_to(self.container_root)
        sidecar = self.work / "storage" / "sidecar"
        return [sidecar / Path(*relative.with_suffix("").parts).with_suffix(".yml"),
                sidecar / Path(*relative.parts).with_name(relative.name + ".json")]

    def export(self, refs: list[PhotoRef]) -> bytes:
        archive = self.api.post("/api/v1/zip", {"photos": [r.id for r in refs]})
        _status, body, _headers = self.api.raw("GET", f"/api/v1/zip/{archive['filename']}",
                                               query={"t": self.download_token},
                                               headers={"Accept": "application/zip"})
        return body

    def trash(self, ref: PhotoRef) -> None:
        self.api.post("/api/v1/batch/photos/archive", {"photos": [ref.id]})

    def purge(self, ref: PhotoRef) -> None:
        self.api.post("/api/v1/batch/photos/delete", {"photos": [ref.id]})

    def trash_policy(self) -> dict[str, Any]:
        return {"auto_expiry": False, "note": "no automatic deletion of archived photos found in code (unverified)"}


ADAPTERS: dict[str, type[Adapter]] = {a.name: a for a in (LibrePhotos, LibrePhotosDev, Immich, PhotoPrism)}


def _attempt(call: Callable[[], Any]) -> str:
    try:
        call()
        return "ok"
    except HttpError as error:
        return f"http {error.status}: {error.body[:160]}"
    except (OSError, KeyError, TypeError, ValueError, IndexError) as error:
        return f"error: {error}"
