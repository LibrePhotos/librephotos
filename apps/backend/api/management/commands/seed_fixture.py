"""Build the deterministic fixture library the Rust backend is tested against.

See plans/rust-backend/06-testing.md §1. Media files are ingested through the
real per-file-group scan handler (thumbnails, EXIF, dates, pHash), synchronously
and with ML off; everything an ML sidecar would produce (faces, persons,
clusters, captions, tags, OCR, places) is injected through the ORM afterwards.

Run it on a freshly migrated database with an empty ``PHOTOS`` tree; it refuses
to run twice. apps/backend-rs/tests/fixture/build_fixture.sh drives it.
"""

import datetime
import json
import os
import random
import shutil
import subprocess
import uuid

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from PIL import Image, ImageDraw

from api import binaries
from api.autoalbum import generate_event_albums
from api.directory_watcher.file_handlers import handle_file_group
from api.directory_watcher.scan_jobs import _partition_scan_paths
from api.directory_watcher.utils import walk_directory
from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Cluster,
    Face,
    LongRunningJob,
    Person,
    Photo,
    Thumbnail,
    User,
)
from api.models.album_user_share import AlbumUserShare
from api.models.cluster import get_unknown_cluster
from api.models.duplicate import Duplicate
from api.models.photo_caption import PhotoCaption
from api.models.photo_ocr import PhotoOcr
from api.models.photo_search import PhotoSearch
from api.models.photo_share import PhotoShare
from api.models.photo_stack import PhotoStack
from api.models.tag import Tag, get_tag, refresh_tag_photo_counts
from api.models.user import get_deleted_user
from api.photo_faces import save_detected_face

UTC = datetime.UTC
SEED = 20260929

USERS = [
    # username, superuser, first name
    ("admin", True, "Admin"),
    ("alice", False, "Alice"),
    ("bob", False, "Bob"),
    ("carol", False, "Carol"),
    ("dave", False, "Dave"),
]

PUBLIC_ALBUM_SLUG = "fixture-public-trip"
EXPIRED_ALBUM_SLUG = "fixture-expired-share"
PHOTO_SHARE_SLUG = "fixture-photo-share"

# Canned reverse-geocoder answers, in the nominatim parser's shape.
PLACES = {
    "berlin": (52.5163, 13.3777, ["Pariser Platz", "Mitte", "Berlin", "Germany"]),
    "tokyo": (35.6586, 139.7454, ["Shiba-koen", "Minato", "Tokyo", "Japan"]),
}


def _password(username):
    return f"lp-fixture-{username}-pw"


class _InProcessResponse:
    def __init__(self, flask_response):
        self.status_code = flask_response.status_code
        self._body = flask_response.get_json(silent=True)

    def json(self):
        if self._body is None:
            raise ValueError("no JSON body")
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(
                f"exif sidecar answered {self.status_code}", response=self
            )


def _route_exif_in_process():
    """Serve exif sidecar calls from its Flask app inside this process.

    The sidecar port (8010) is fixed and shared by every checkout on the
    machine, so the build neither needs one running nor starts its own.
    """
    from api import sidecars
    from service.exif.main import app

    client = app.test_client()
    original = sidecars.post

    def post(service, path, *, json, timeout):
        if service != "exif":
            return original(service, path, json=json, timeout=timeout)
        response = _InProcessResponse(client.post(path, json=json))
        response.raise_for_status()
        return response

    sidecars.post = post


class _Rng:
    """Seeded source for every id the ORM would otherwise draw at random."""

    def __init__(self, seed):
        self._random = random.Random(seed)

    def uuid(self):
        return uuid.UUID(int=self._random.getrandbits(128), version=4)


def _patch_uuid_defaults(rng):
    for model in (Photo, PhotoStack, Duplicate):
        field = model._meta.get_field("id")
        field.default = rng.uuid
        field.__dict__.pop("_get_default", None)


def _dms(value):
    value = abs(value)
    degrees = int(value)
    minutes_full = (value - degrees) * 60
    minutes = int(minutes_full)
    seconds = round((minutes_full - minutes) * 60, 4)
    return (float(degrees), float(minutes), seconds)


def _exif(
    dt=None, gps=None, make="LibrePhotos", model="Fixture Generator", subsec=None
):
    exif = Image.Exif()
    exif[0x010F] = make
    exif[0x0110] = model
    if dt is not None:
        stamp = dt.strftime("%Y:%m:%d %H:%M:%S")
        exif[0x0132] = stamp
        exif_ifd = exif.get_ifd(0x8769)
        exif_ifd[0x9003] = stamp
        exif_ifd[0x9004] = stamp
        if subsec is not None:
            exif_ifd[0x9291] = subsec
    if gps is not None:
        lat, lon = gps
        gps_ifd = exif.get_ifd(0x8825)
        gps_ifd[0x0000] = b"\x02\x03\x00\x00"
        gps_ifd[0x0001] = "N" if lat >= 0 else "S"
        gps_ifd[0x0002] = _dms(lat)
        gps_ifd[0x0003] = "E" if lon >= 0 else "W"
        gps_ifd[0x0004] = _dms(lon)
    return exif


def _picture(seed, size=(800, 600)):
    rng = random.Random(seed)
    base = tuple(rng.randrange(40, 216) for _ in range(3))
    image = Image.new("RGB", size, base)
    draw = ImageDraw.Draw(image)
    width, height = size
    for _ in range(14):
        x0, y0 = rng.randrange(width), rng.randrange(height)
        x1 = min(width, x0 + rng.randrange(40, width // 2))
        y1 = min(height, y0 + rng.randrange(40, height // 2))
        colour = tuple(rng.randrange(256) for _ in range(3))
        if rng.random() < 0.5:
            draw.rectangle([x0, y0, x1, y1], fill=colour)
        else:
            draw.ellipse([x0, y0, x1, y1], fill=colour)
    return image


class Library:
    """The files written for one build, keyed by a stable logical name."""

    def __init__(self, photos_root):
        self.photos_root = photos_root
        self.paths = {}

    def path(self, owner, *parts):
        path = os.path.normpath(os.path.join(self.photos_root, owner, *parts))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def jpeg(
        self, key, owner, relpath, seed, dt=None, gps=None, size=(800, 600), subsec=None
    ):
        path = self.path(owner, relpath)
        _picture(seed, size).save(
            path, "JPEG", quality=88, exif=_exif(dt, gps, subsec=subsec)
        )
        self.paths[key] = path
        return path

    def png(self, key, owner, relpath, seed, size=(640, 480)):
        path = self.path(owner, relpath)
        _picture(seed, size).save(path, "PNG")
        self.paths[key] = path
        return path

    def copy(self, key, owner, relpath, source):
        path = self.path(owner, relpath)
        shutil.copyfile(source, path)
        self.paths[key] = path
        return path


class Command(BaseCommand):
    help = "Build the deterministic Rust-backend fixture library (plans/rust-backend/06 §1)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--manifest", required=True, help="Where to write manifest.json"
        )
        parser.add_argument(
            "--e2e-photos",
            default=os.path.join(
                os.path.dirname(settings.BASE_DIR),
                "..",
                "..",
                "deploy",
                "e2e",
                "photos",
            ),
            help="deploy/e2e/photos",
        )

    def handle(self, *args, **options):
        if User.objects.filter(username__in=[u for u, _, _ in USERS]).exists():
            raise CommandError("The database is already seeded; build on a fresh one.")
        photos_root = os.path.normpath(settings.DATA_ROOT)
        if os.path.isdir(photos_root) and os.listdir(photos_root):
            raise CommandError(
                f"{photos_root} is not empty; build on a fresh media tree."
            )
        e2e_dir = os.path.normpath(options["e2e_photos"])
        if not os.path.isdir(e2e_dir):
            raise CommandError(f"{e2e_dir} does not exist")
        if settings.FEATURE_FACE_DETECTION or settings.FEATURE_SCENE_CLASSIFICATION:
            self.stderr.write(
                "warning: ML features are on; the seed injects ML rows itself"
            )

        self.rng = _Rng(SEED)
        _patch_uuid_defaults(self.rng)
        _route_exif_in_process()
        self.library = Library(photos_root)
        self.photos = {}

        self.users = self._create_users(photos_root)
        self._write_media(e2e_dir)
        for username in ("admin", "alice", "bob", "carol", "dave"):
            self._ingest(self.users[username])
        self._collect_photos()

        with transaction.atomic():
            self._states()
            self._places()
            self._faces()
            self._captions_and_tags()
            self._ocr()
            self._stacks_and_duplicates()
            self._albums_and_shares()
        for username in ("alice", "bob"):
            generate_event_albums(self.users[username], str(self.rng.uuid()))
        with transaction.atomic():
            self._refresh_derived()
            self._jobs()

        self._write_manifest(options["manifest"], photos_root)
        self.stdout.write(
            self.style.SUCCESS(f"fixture seeded: {len(self.photos)} photos")
        )

    # --- users --------------------------------------------------------------

    def _create_users(self, photos_root):
        users = {}
        for username, superuser, first_name in USERS:
            scan_directory = os.path.normpath(os.path.join(photos_root, username))
            os.makedirs(scan_directory, exist_ok=True)
            maker = (
                User.objects.create_superuser if superuser else User.objects.create_user
            )
            user = maker(
                username=username,
                email=f"{username}@fixture.invalid",
                password=_password(username),
                first_name=first_name,
                last_name="Fixture",
            )
            user.scan_directory = scan_directory
            user.save()
            users[username] = user
        get_deleted_user()
        return users

    # --- files --------------------------------------------------------------

    def _write_media(self, e2e_dir):
        lib = self.library
        for name in sorted(os.listdir(e2e_dir)):
            if name.lower().endswith(".jpg"):
                lib.copy(
                    f"alice/{name[:-4]}",
                    "alice",
                    os.path.join("e2e", name),
                    os.path.join(e2e_dir, name),
                )

        d = datetime.datetime
        lib.jpeg(
            "alice/berlin_01",
            "alice",
            "trips/berlin_01.jpg",
            101,
            d(2022, 6, 10, 9, 15),
            PLACES["berlin"][:2],
        )
        lib.jpeg(
            "alice/berlin_02",
            "alice",
            "trips/berlin_02.jpg",
            102,
            d(2022, 6, 10, 17, 40),
            PLACES["berlin"][:2],
        )
        lib.jpeg(
            "alice/tokyo_01",
            "alice",
            "trips/tokyo_01.jpg",
            103,
            d(2022, 11, 3, 8, 5),
            PLACES["tokyo"][:2],
        )

        for idx in range(4):
            lib.jpeg(
                f"alice/burst_{idx + 1}",
                "alice",
                f"burst/IMG_20240301_120000_{idx + 1:03d}.jpg",
                200 + idx,
                d(2024, 3, 1, 12, 0, idx // 2),
                subsec=f"{(idx % 2) * 50:02d}",
            )
        lib.jpeg(
            "alice/manual_a", "alice", "stack/manual_a.jpg", 210, d(2024, 2, 14, 18, 0)
        )
        lib.jpeg(
            "alice/manual_b", "alice", "stack/manual_b.jpg", 211, d(2024, 2, 14, 18, 30)
        )

        original = lib.jpeg(
            "alice/dup_original",
            "alice",
            "dupes/dup_original.jpg",
            300,
            d(2023, 12, 24, 19, 0),
        )
        resized = lib.path("alice", "dupes/dup_resized.jpg")
        with Image.open(original) as img:
            exif = img.getexif()
            img.resize((640, 480)).save(resized, "JPEG", quality=70, exif=exif)
        lib.paths["alice/dup_resized"] = resized

        lib.jpeg(
            "alice/unicode",
            "alice",
            "names/Straße ☀ 東京.jpg",
            400,
            d(2021, 4, 1, 12, 0),
        )
        lib.jpeg(
            "alice/specialchars",
            "alice",
            "names/100% #1; semi.jpg",
            401,
            d(2021, 4, 2, 12, 0),
        )

        lib.jpeg(
            "alice/hidden", "alice", "states/hidden.jpg", 500, d(2020, 1, 1, 10, 0)
        )
        lib.jpeg(
            "alice/trashed", "alice", "states/trashed.jpg", 501, d(2020, 1, 2, 10, 0)
        )
        lib.jpeg(
            "alice/removed", "alice", "states/removed.jpg", 502, d(2020, 1, 3, 10, 0)
        )
        lib.jpeg(
            "alice/no_thumbnail",
            "alice",
            "states/no_thumbnail.jpg",
            503,
            d(2020, 1, 4, 10, 0),
        )
        path = lib.path("alice", "states/no_timestamp.jpg")
        _picture(504).save(path, "JPEG", quality=88, exif=_exif(None))
        lib.paths["alice/no_timestamp"] = path

        lib.png("alice/png", "alice", "formats/plain.png", 600)
        self._heic(lib.path("alice", "formats/sample.heic"), d(2022, 8, 20, 14, 0))
        lib.paths["alice/heic"] = lib.path("alice", "formats/sample.heic")
        self._video(lib.path("alice", "formats/clip.mp4"))
        lib.paths["alice/video"] = lib.path("alice", "formats/clip.mp4")

        raw_jpeg = lib.jpeg(
            "alice/raw_pair", "alice", "raw/DSC_0001.jpg", 610, d(2022, 9, 9, 9, 9)
        )
        self._fake_dng(raw_jpeg, lib.path("alice", "raw/DSC_0001.dng"))

        lib.jpeg(
            "alice/xmp", "alice", "sidecar/xmp_photo.jpg", 620, d(2023, 3, 3, 15, 0)
        )
        with open(
            lib.path("alice", "sidecar/xmp_photo.xmp"), "w", encoding="utf-8"
        ) as fh:
            fh.write(_XMP_SIDECAR)

        png = lib.path("alice", "Screenshots/Screenshot_20240115-093000.png")
        _picture(630, (1080, 1920)).save(png, "PNG")
        lib.paths["alice/screenshot"] = png

        e2e_01 = os.path.join(e2e_dir, "e2e_01.jpg")
        lib.copy("bob/e2e_01", "bob", "e2e_01.jpg", e2e_01)
        lib.jpeg("bob/own_01", "bob", "bob_own_01.jpg", 700, d(2024, 5, 12, 11, 0))
        lib.jpeg("bob/own_02", "bob", "bob_own_02.jpg", 701, d(2024, 5, 13, 11, 0))
        lib.jpeg("carol/own_01", "carol", "carol_own_01.jpg", 800, d(2024, 6, 1, 8, 0))
        lib.jpeg("dave/own_01", "dave", "dave_own_01.jpg", 900, d(2024, 7, 1, 8, 0))
        lib.jpeg("admin/own_01", "admin", "admin_own_01.jpg", 1000, d(2024, 8, 1, 8, 0))

    def _heic(self, path, dt):
        from pillow_heif import register_heif_opener

        register_heif_opener()
        _picture(640).save(path, "HEIF", quality=80, exif=_exif(dt).tobytes())

    def _video(self, path):
        subprocess.run(
            [
                binaries.ffmpeg(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=2:size=320x240:rate=10",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-fflags",
                "+bitexact",
                "-flags:v",
                "+bitexact",
                "-metadata",
                "creation_time=2024-05-12T12:00:00Z",
                path,
            ],
            check=True,
        )

    def _fake_dng(self, jpeg_path, dng_path):
        # A TIFF carrying DNGVersion: is_raw() goes by extension and ingest never
        # decodes a non-main variant, so this only has to look like a DNG.
        with Image.open(jpeg_path) as img:
            img.resize((200, 150)).save(dng_path, "TIFF")
        subprocess.run(
            [
                binaries.exiftool(),
                "-q",
                "-overwrite_original",
                "-DNGVersion=1.4.0.0",
                dng_path,
            ],
            check=True,
        )

    # --- ingest -------------------------------------------------------------

    def _ingest(self, user):
        # scan_photos creates these before queueing any file group.
        for name in ("square_thumbnails_small", "square_thumbnails", "thumbnails_big"):
            os.makedirs(os.path.join(settings.MEDIA_ROOT, name), exist_ok=True)
        found = []
        walk_directory(user.scan_directory, found)
        file_groups, metadata_paths = _partition_scan_paths(found)
        groups = sorted(file_groups.items())
        job_id = str(self.rng.uuid())
        lrj = LongRunningJob.get_or_create_job(
            user=user, job_type=LongRunningJob.JOB_SCAN_PHOTOS, job_id=job_id
        )
        lrj.update_progress(current=0, target=len(groups))
        for _, paths in groups:
            handle_file_group(user, sorted(paths), job_id)
        if metadata_paths:
            raise CommandError(f"unexpected orphan sidecars: {metadata_paths}")
        lrj.refresh_from_db()
        if not lrj.finished or (lrj.result or {}).get("error_count"):
            raise CommandError(
                f"scan for {user.username} did not finish cleanly: {lrj.result}"
            )

    def _collect_photos(self):
        by_path = {}
        for photo in Photo.objects.select_related("main_file", "owner"):
            for f in photo.files.all():
                by_path[os.path.normcase(f.path)] = photo
        for key, path in self.library.paths.items():
            photo = by_path.get(os.path.normcase(path))
            if photo is None:
                raise CommandError(f"{key} ({path}) was not ingested")
            self.photos[key] = photo

    def p(self, key):
        photo = self.photos[key]
        photo.refresh_from_db()
        return photo

    # --- edge states --------------------------------------------------------

    def _states(self):
        Photo.objects.filter(pk=self.photos["alice/hidden"].pk).update(hidden=True)
        Photo.objects.filter(pk=self.photos["alice/trashed"].pk).update(
            in_trashcan=True
        )

        removed = self.p("alice/removed")
        removed.in_trashcan = True
        removed.save(save_metadata=False)
        removed.manual_delete()

        thumb = Thumbnail.objects.get(photo=self.photos["alice/no_thumbnail"])
        for field in (
            thumb.thumbnail_big,
            thumb.square_thumbnail,
            thumb.square_thumbnail_small,
        ):
            if field and os.path.exists(field.path):
                os.remove(field.path)
        Thumbnail.objects.filter(pk=thumb.pk).update(
            thumbnail_big="",
            square_thumbnail="",
            square_thumbnail_small="",
            aspect_ratio=None,
        )

        for key in ("alice/no_timestamp", "alice/png"):
            photo = self.p(key)
            if photo.exif_timestamp is not None:
                raise CommandError(
                    f"{key} unexpectedly has a timestamp {photo.exif_timestamp}"
                )

        Photo.objects.filter(
            pk__in=[self.photos[k].pk for k in ("alice/e2e_05", "alice/berlin_01")]
        ).update(public=True)
        for key in ("alice/e2e_06", "alice/e2e_07"):
            self.photos[key].shared_to.add(self.users["bob"])
        Photo.objects.filter(pk=self.photos["alice/e2e_01"].pk).update(rating=5)
        Photo.objects.filter(pk=self.photos["alice/e2e_02"].pk).update(rating=3)

    def _places(self):
        from api.geocode import photo_location

        def fake_reverse_geocode(lat, lon):
            for plat, plon, places in PLACES.values():
                if abs(float(lat) - plat) < 0.01 and abs(float(lon) - plon) < 0.01:
                    center = [plat, plon]
                    return {
                        "features": [{"text": p, "center": center} for p in places],
                        "places": places,
                        "address": ", ".join(places),
                        "center": center,
                        "_v": "1",
                    }
            return {}

        original = photo_location.reverse_geocode
        photo_location.reverse_geocode = fake_reverse_geocode
        try:
            for key in ("alice/berlin_01", "alice/berlin_02", "alice/tokyo_01"):
                photo = self.p(key)
                photo_location.geolocate_photo(photo)
                photo_location.add_location_to_album_dates(photo)
        finally:
            photo_location.reverse_geocode = original

    # --- ML-derived rows ----------------------------------------------------

    def _encoding(self, base, noise_seed, scale=0.05):
        rng = np.random.default_rng(noise_seed)
        vec = base + rng.normal(scale=scale, size=512)
        return (vec / np.linalg.norm(vec)).astype(np.float64)

    def _face(
        self,
        key,
        idx,
        person,
        cluster,
        encoding,
        cluster_person=None,
        cluster_probability=0.0,
        classification_person=None,
        classification_probability=0.0,
        deleted=False,
    ):
        photo = self.p(key)
        with Image.open(photo.thumbnail.thumbnail_big.path) as big:
            width, height = big.size
            top, left = int(height * 0.2) + idx * 10, int(width * 0.3) + idx * 40
            bottom, right = top + height // 4, left + width // 5
            crop = big.convert("RGB").crop((left, top, right, bottom))
        face = save_detected_face(
            photo,
            crop,
            f"{photo.image_hash}_{idx}.jpg",
            person,
            cluster,
            (top, right, bottom, left),
            encoding,
        )
        face.cluster_person = cluster_person
        face.cluster_probability = cluster_probability
        face.classification_person = classification_person
        face.classification_probability = classification_probability
        face.deleted = deleted
        face.save()
        return face

    def _faces(self):
        alice, bob = self.users["alice"], self.users["bob"]
        base = np.random.default_rng(SEED).normal(size=(4, 512))

        anna = Person.objects.create(
            name="Anna Müller", kind=Person.KIND_USER, cluster_owner=alice
        )
        ben = Person.objects.create(
            name="Ben", kind=Person.KIND_USER, cluster_owner=alice
        )
        cluster_person = Person.objects.create(
            name="Cluster 1", kind=Person.KIND_CLUSTER, cluster_owner=alice
        )
        bobs_friend = Person.objects.create(
            name="Bob's Friend", kind=Person.KIND_USER, cluster_owner=bob
        )

        c_anna = Cluster.objects.create(
            owner=alice, cluster_id=1, person=anna, name="Anna Müller"
        )
        c_ben = Cluster.objects.create(
            owner=alice, cluster_id=2, person=ben, name="Ben"
        )
        c_third = Cluster.objects.create(
            owner=alice, cluster_id=3, person=cluster_person, name="Cluster 1"
        )
        unknown = get_unknown_cluster(alice)
        c_bob = Cluster.objects.create(
            owner=bob, cluster_id=1, person=bobs_friend, name="Bob's Friend"
        )

        faces = {
            "anna": [],
            "ben": [],
            "cluster_1": [],
            "inferred_ben": [],
            "unknown": [],
            "deleted": [],
            "bob": [],
        }
        for n, key in enumerate(
            ("alice/e2e_01", "alice/e2e_02", "alice/e2e_05", "alice/berlin_01")
        ):
            faces["anna"].append(
                self._face(
                    key,
                    0,
                    anna,
                    c_anna,
                    self._encoding(base[0], 100 + n),
                    cluster_person=anna,
                    cluster_probability=1.0,
                )
            )
        faces["ben"].append(
            self._face(
                "alice/e2e_03",
                0,
                ben,
                c_ben,
                self._encoding(base[1], 200),
                cluster_person=ben,
                cluster_probability=1.0,
            )
        )
        faces["ben"].append(
            self._face(
                "alice/e2e_01",
                1,
                ben,
                c_ben,
                self._encoding(base[1], 201),
                cluster_person=ben,
                cluster_probability=1.0,
            )
        )
        faces["inferred_ben"].append(
            self._face(
                "alice/e2e_06",
                0,
                None,
                c_ben,
                self._encoding(base[1], 202),
                cluster_person=ben,
                cluster_probability=0.82,
                classification_person=ben,
                classification_probability=0.71,
            )
        )
        for n, key in enumerate(("alice/e2e_04", "alice/e2e_07")):
            faces["cluster_1"].append(
                self._face(
                    key,
                    0,
                    None,
                    c_third,
                    self._encoding(base[2], 300 + n),
                    cluster_person=cluster_person,
                    cluster_probability=0.9,
                    classification_person=cluster_person,
                    classification_probability=0.6,
                )
            )
        faces["unknown"].append(
            self._face("alice/e2e_08", 0, None, unknown, self._encoding(base[3], 400))
        )
        faces["deleted"].append(
            self._face(
                "alice/tokyo_01",
                0,
                anna,
                c_anna,
                self._encoding(base[0], 500),
                cluster_person=anna,
                cluster_probability=1.0,
                deleted=True,
            )
        )
        faces["bob"].append(
            self._face(
                "bob/own_01",
                0,
                bobs_friend,
                c_bob,
                self._encoding(base[3], 600),
                cluster_person=bobs_friend,
                cluster_probability=1.0,
            )
        )

        for cluster in (c_anna, c_ben, c_third, unknown, c_bob):
            vectors = [
                f.get_encoding_array() for f in Face.objects.filter(cluster=cluster)
            ]
            if vectors:
                cluster.set_metadata(vectors)
                cluster.save()

        for person in (anna, ben, cluster_person, bobs_friend):
            person._calculate_face_count()
            person._set_default_cover_photo()
        # Inferred-only persons have no labelled faces for the default cover.
        cluster_person.cover_photo = faces["cluster_1"][0].photo
        cluster_person.cover_face = faces["cluster_1"][0]
        cluster_person.save()

        self.persons = {
            "anna": anna,
            "ben": ben,
            "cluster_1": cluster_person,
            "bobs_friend": bobs_friend,
        }
        self.faces = faces

    def _captions_and_tags(self):
        from constance import config as site_config

        model = site_config.TAGGING_MODEL
        captions = {
            "alice/e2e_01": (
                "a colourful test pattern with shapes",
                ["pattern", "outdoor"],
                "First day",
            ),
            "alice/e2e_02": (
                "a colourful test pattern with shapes",
                ["pattern", "outdoor"],
                None,
            ),
            "alice/e2e_03": (
                "abstract rectangles on a wall",
                ["pattern", "indoor"],
                None,
            ),
            "alice/e2e_05": (
                "a sunny afternoon",
                ["sky", "outdoor"],
                "Summer #holiday",
            ),
            "alice/berlin_01": (
                "the brandenburg gate at dawn",
                ["city", "monument"],
                None,
            ),
            "alice/tokyo_01": ("a tower over the city", ["city", "tower"], None),
            "bob/own_01": ("bob's desk", ["indoor"], None),
        }
        for key, (im2txt, tags, user_caption) in captions.items():
            photo = self.p(key)
            caption, _ = PhotoCaption.objects.get_or_create(photo=photo)
            data = {"im2txt": im2txt, model: {"tags": tags}}
            if user_caption:
                data["user_caption"] = user_caption
            caption.captions_json = data
            caption._update_tag_album_things({"tags": tags}, model)
            caption.save()

        alice, bob = self.users["alice"], self.users["bob"]
        tag_rows = {
            ("alice", "family"): ["alice/e2e_01", "alice/e2e_02", "alice/e2e_03"],
            ("alice", "Straße ☀"): ["alice/unicode"],
            ("alice", "trips"): [
                "alice/berlin_01",
                "alice/berlin_02",
                "alice/tokyo_01",
                "alice/hidden",
            ],
            ("bob", "bobs-tag"): ["bob/own_01", "bob/e2e_01"],
        }
        for (owner, name), keys in tag_rows.items():
            tag = get_tag(name, alice if owner == "alice" else bob)
            tag.photos.add(*[self.photos[k] for k in keys])

    def _ocr(self):
        photo = self.p("alice/screenshot")
        PhotoOcr.objects.create(
            photo=photo,
            text="Invoice 42\nTotal: 19,99 EUR",
            blocks=[
                {
                    "text": "Invoice 42",
                    "box": [[100, 200], [500, 200], [500, 260], [100, 260]],
                    "confidence": 0.97,
                },
                {
                    "text": "Total: 19,99 EUR",
                    "box": [[100, 300], [700, 300], [700, 360], [100, 360]],
                    "confidence": 0.91,
                },
            ],
            source_width=1080,
            source_height=1920,
            engine="fixture",
            mean_confidence=0.94,
            text_area_fraction=0.03,
        )
        Photo.objects.filter(pk=photo.pk).update(is_document=True)

    def _stacks_and_duplicates(self):
        alice = self.users["alice"]
        burst = [self.p(f"alice/burst_{i}") for i in range(1, 5)]
        self.burst_stack = PhotoStack.create_or_merge(
            alice,
            PhotoStack.StackType.BURST_SEQUENCE,
            burst,
            sequence_start=burst[0].exif_timestamp,
            sequence_end=burst[-1].exif_timestamp,
        )
        self.manual_stack = PhotoStack.create_or_merge(
            alice,
            PhotoStack.StackType.MANUAL,
            [self.p("alice/manual_a"), self.p("alice/manual_b")],
        )
        self.duplicate = Duplicate.create_or_merge(
            alice,
            Duplicate.DuplicateType.VISUAL_DUPLICATE,
            [self.p("alice/dup_original"), self.p("alice/dup_resized")],
            similarity_score=0.96,
        )

    def _albums_and_shares(self):
        alice, bob, carol = self.users["alice"], self.users["bob"], self.users["carol"]

        def album(owner, title, keys, cover=None):
            a = AlbumUser.objects.create(owner=owner, title=title)
            a.photos.add(*[self.photos[k] for k in keys])
            a.cover_photo = self.photos[cover or keys[0]]
            a.save()
            return a

        self.albums = {
            "vacation": album(
                alice,
                "Vacation 2024",
                ["alice/e2e_01", "alice/e2e_02", "alice/e2e_03", "alice/e2e_04"],
                "alice/e2e_02",
            ),
            "shared_to_carol": album(
                alice,
                "Shared with Carol",
                ["alice/e2e_05", "alice/e2e_06", "bob/own_02"],
            ),
            "public_trip": album(
                alice, "Public Trip", ["alice/berlin_01", "alice/berlin_02"]
            ),
            "expired": album(alice, "Expired Share", ["alice/tokyo_01"]),
            "unicode": album(
                alice, "Ünïcödé ☀ 100% #;", ["alice/unicode", "alice/specialchars"]
            ),
            "bob_album": album(bob, "Bob Album", ["bob/own_01", "bob/e2e_01"]),
        }
        self.albums["shared_to_carol"].shared_to.add(carol)
        AlbumUserShare.objects.create(
            album=self.albums["public_trip"], enabled=True, slug=PUBLIC_ALBUM_SLUG
        )
        AlbumUserShare.objects.create(
            album=self.albums["expired"],
            enabled=True,
            slug=EXPIRED_ALBUM_SLUG,
            expires_at=datetime.datetime(2020, 1, 1, tzinfo=UTC),
        )
        PhotoShare.objects.create(
            photo=self.photos["alice/e2e_08"], enabled=True, slug=PHOTO_SHARE_SLUG
        )

    def _refresh_derived(self):
        for photo in Photo.objects.all():
            search, _ = PhotoSearch.objects.get_or_create(photo=photo)
            search.recreate_search_captions()
            search.save()
        refresh_tag_photo_counts(list(Tag.objects.values_list("pk", flat=True)))
        for thing in AlbumThing.objects.all():
            thing.photo_count = thing.photos.filter(hidden=False).count()
            thing.save(update_fields=["photo_count"])

    def _jobs(self):
        alice, admin = self.users["alice"], self.users["admin"]
        now = datetime.datetime.now(UTC)
        self.jobs = {}
        failed = LongRunningJob.objects.create(
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            job_id=str(self.rng.uuid()),
            started_by=alice,
            queued_at=now,
            started_at=now,
            finished_at=now,
            finished=True,
            failed=True,
            progress_current=2,
            progress_target=5,
            result={
                "status": "failed",
                "error": "fixture: tag service unavailable",
                "errors": ["fixture: tag service unavailable"],
                "error_count": 3,
            },
        )
        running = LongRunningJob.objects.create(
            job_type=LongRunningJob.JOB_SCAN_FACES,
            job_id=str(self.rng.uuid()),
            started_by=alice,
            queued_at=now,
            started_at=now,
            progress_current=3,
            progress_target=10,
        )
        finished = LongRunningJob.objects.create(
            job_type=LongRunningJob.JOB_DETECT_DUPLICATES,
            job_id=str(self.rng.uuid()),
            started_by=admin,
            queued_at=now,
            started_at=now,
            finished_at=now,
            finished=True,
            progress_current=1,
            progress_target=1,
            result={"status": "completed"},
        )
        self.jobs = {"failed": failed, "running": running, "finished": finished}

    # --- manifest -----------------------------------------------------------

    def _photo_entry(self, key, photo):
        photo.refresh_from_db()
        thumb = Thumbnail.objects.filter(photo=photo).first()
        return {
            "id": str(photo.id),
            "image_hash": photo.image_hash,
            "owner": photo.owner.username,
            "path": self.library.paths[key],
            "main_file": photo.main_file.path if photo.main_file else None,
            "files": sorted(
                (
                    {"hash": f.hash, "path": f.path, "type": f.type}
                    for f in photo.files.all()
                ),
                key=lambda f: f["path"],
            ),
            "exif_timestamp": photo.exif_timestamp.isoformat()
            if photo.exif_timestamp
            else None,
            "video": photo.video,
            "hidden": photo.hidden,
            "in_trashcan": photo.in_trashcan,
            "removed": photo.removed,
            "public": photo.public,
            "rating": photo.rating,
            "is_screenshot": photo.is_screenshot,
            "is_document": photo.is_document,
            "perceptual_hash": photo.perceptual_hash,
            "aspect_ratio": thumb.aspect_ratio if thumb else None,
            "shared_to": sorted(u.username for u in photo.shared_to.all()),
        }

    def _write_manifest(self, manifest_path, photos_root):
        photos = {
            key: self._photo_entry(key, photo) for key, photo in self.photos.items()
        }
        categories = {
            "e2e": sorted(key for key in photos if key.startswith("alice/e2e_")),
            "hidden": ["alice/hidden"],
            "trashed": ["alice/trashed"],
            "removed": ["alice/removed"],
            "no_timestamp": ["alice/no_timestamp", "alice/png"],
            "no_thumbnail": ["alice/no_thumbnail"],
            "public": ["alice/e2e_05", "alice/berlin_01"],
            "shared_to_bob": ["alice/e2e_06", "alice/e2e_07"],
            "same_file_two_users": ["alice/e2e_01", "bob/e2e_01"],
            "burst_stack": [f"alice/burst_{i}" for i in range(1, 5)],
            "manual_stack": ["alice/manual_a", "alice/manual_b"],
            "duplicate_group": ["alice/dup_original", "alice/dup_resized"],
            "unicode_names": ["alice/unicode", "alice/specialchars"],
            "video": ["alice/video"],
            "heic": ["alice/heic"],
            "png": ["alice/png", "alice/screenshot"],
            "raw_variant": ["alice/raw_pair"],
            "xmp_sidecar": ["alice/xmp"],
            "screenshot": ["alice/screenshot"],
            "ocr": ["alice/screenshot"],
            "gps": ["alice/berlin_01", "alice/berlin_02", "alice/tokyo_01"],
            "captioned": [
                "alice/e2e_01",
                "alice/e2e_02",
                "alice/e2e_03",
                "alice/e2e_05",
                "alice/berlin_01",
                "alice/tokyo_01",
                "bob/own_01",
            ],
            "ghsa_foreign_photo_in_carol_album": ["bob/own_02"],
            "photo_share": ["alice/e2e_08"],
            "rated": ["alice/e2e_01", "alice/e2e_02"],
        }
        users = {
            name: {
                "id": user.id,
                "username": name,
                "password": _password(name),
                "is_admin": user.is_superuser,
                "scan_directory": user.scan_directory,
                "photo_count": Photo.objects.filter(owner=user).count(),
            }
            for name, user in self.users.items()
        }
        deleted = User.objects.get(username="deleted")

        def album_entry(a):
            return {
                "id": a.id,
                "title": a.title,
                "owner": a.owner.username,
                "photos": sorted(
                    str(pid) for pid in a.photos.values_list("id", flat=True)
                ),
                "cover_photo": str(a.cover_photo_id) if a.cover_photo_id else None,
                "shared_to": sorted(u.username for u in a.shared_to.all()),
            }

        albums = {
            "user": {name: album_entry(a) for name, a in self.albums.items()},
            "auto": [
                {
                    "id": a.id,
                    "title": a.title,
                    "owner": a.owner.username,
                    "photo_count": a.photos.count(),
                }
                for a in AlbumAuto.objects.order_by("id")
            ],
            "date": [
                {
                    "id": a.id,
                    "date": a.date.isoformat() if a.date else None,
                    "owner": a.owner.username,
                    "photo_count": a.photos.count(),
                }
                for a in AlbumDate.objects.order_by("owner_id", "date", "id")
            ],
            "thing": [
                {
                    "id": a.id,
                    "title": a.title,
                    "thing_type": a.thing_type,
                    "owner": a.owner.username,
                    "photo_count": a.photo_count,
                }
                for a in AlbumThing.objects.order_by("id")
            ],
            "place": [
                {
                    "id": a.id,
                    "title": a.title,
                    "owner": a.owner.username,
                    "geolocation_level": a.geolocation_level,
                    "photo_count": a.photos.count(),
                }
                for a in AlbumPlace.objects.order_by("id")
            ],
        }
        manifest = {
            "version": 1,
            "built_at": datetime.datetime.now(UTC).isoformat(),
            "seed": SEED,
            "base_data": os.path.normpath(os.path.dirname(settings.MEDIA_ROOT)),
            "media_root": os.path.normpath(settings.MEDIA_ROOT),
            "photos_root": photos_root,
            "users": users,
            "system_users": {"deleted": {"id": deleted.id, "username": "deleted"}},
            "anonymous": {"public_photos": categories["public"]},
            "photos": photos,
            "categories": categories,
            "albums": albums,
            "shares": {
                "public_album": {
                    "slug": PUBLIC_ALBUM_SLUG,
                    "album": "public_trip",
                    "album_id": self.albums["public_trip"].id,
                },
                "expired_album": {
                    "slug": EXPIRED_ALBUM_SLUG,
                    "album": "expired",
                    "album_id": self.albums["expired"].id,
                },
                "photo_share": {"slug": PHOTO_SHARE_SLUG, "photo": "alice/e2e_08"},
                "album_shared_to_carol": {
                    "album": "shared_to_carol",
                    "album_id": self.albums["shared_to_carol"].id,
                    "foreign_photo": "bob/own_02",
                },
            },
            "persons": {
                name: {
                    "id": p.id,
                    "name": p.name,
                    "kind": p.kind,
                    "owner": p.cluster_owner.username,
                    "face_count": Person.objects.get(pk=p.pk).face_count,
                }
                for name, p in self.persons.items()
            },
            "faces": {
                name: [f.id for f in faces] for name, faces in self.faces.items()
            },
            "tags": [
                {
                    "id": t.id,
                    "name": t.name,
                    "owner": t.owner.username,
                    "photo_count": t.photo_count,
                }
                for t in Tag.objects.order_by("id")
            ],
            "stacks": {
                "burst": {
                    "id": str(self.burst_stack.id),
                    "primary": str(
                        PhotoStack.objects.get(pk=self.burst_stack.pk).primary_photo_id
                    ),
                },
                "manual": {
                    "id": str(self.manual_stack.id),
                    "primary": str(
                        PhotoStack.objects.get(pk=self.manual_stack.pk).primary_photo_id
                    ),
                },
            },
            "duplicates": {"visual": {"id": str(self.duplicate.id)}},
            "jobs": {
                name: {
                    "id": job.id,
                    "job_id": job.job_id,
                    "job_type": job.job_type,
                    "owner": job.started_by.username,
                }
                for name, job in self.jobs.items()
            },
            "scan_jobs": {
                j.started_by.username: j.job_id
                for j in LongRunningJob.objects.filter(
                    job_type=LongRunningJob.JOB_SCAN_PHOTOS
                )
            },
        }
        os.makedirs(os.path.dirname(os.path.abspath(manifest_path)), exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False, sort_keys=False)
            fh.write("\n")


_XMP_SIDECAR = """<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:Rating="4">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>sidecar-keyword</rdf:li>
     <rdf:li>Fixture</rdf:li>
    </rdf:Bag>
   </dc:subject>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Described in an XMP sidecar</rdf:li>
    </rdf:Alt>
   </dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
"""
