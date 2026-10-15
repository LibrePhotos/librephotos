"""Factories for the test database: one place that builds the rows tests need.

Every factory takes the owner the way the app does, fills what the model
requires, and passes other keyword arguments straight to the model. A test
module builds rows with these rather than ``Model.objects.create``; the guard in
api/tests/infra/test_test_data_factories.py enforces it. A row that must be
built raw (a constraint test) says why with ``# raw-create: <reason>``.
"""

import atexit
import datetime
import json
import multiprocessing
import os
import secrets
import shutil
import sys
import tempfile
import uuid
from collections.abc import Iterable
from typing import Any

import numpy as np
from django.http import HttpResponseBase
from django.utils import timezone
from faker import Faker

from api.models import Cluster, Face, File, Person, Photo, User
from api.models.album_auto import AlbumAuto
from api.models.album_collection import AlbumCollection
from api.models.album_date import AlbumDate
from api.models.album_place import AlbumPlace
from api.models.album_thing import AlbumThing
from api.models.album_user import AlbumUser
from api.models.duplicate import Duplicate
from api.models.long_running_job import LongRunningJob
from api.models.person_group import PersonGroup
from api.models.photo_metadata import MetadataEdit
from api.models.photo_stack import PhotoStack
from api.models.tag import Tag
from api.models.thumbnail import Thumbnail
from api.models.upgrade_task_state import UpgradeTaskState
from api.photos.media_files import get_or_create_file

fake = Faker()


def _test_media_root() -> str:
    """One directory per test run, shared by the parallel workers of that run.

    A worker is killed when the run ends, so its exit handlers do not run; the
    main process owns the directory and removes it on exit. Never /tmp itself.
    """
    owner = os.getppid() if multiprocessing.parent_process() else os.getpid()
    root = os.path.join(tempfile.gettempdir(), f"librephotos-test-media-{owner}")
    os.makedirs(root, exist_ok=True)
    if not multiprocessing.parent_process():
        atexit.register(shutil.rmtree, root, ignore_errors=True)
    return root


# Where the files of test photos are written (see _test_media_root).
TEST_MEDIA_ROOT = _test_media_root()

ONE_PIXEL_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\xb1\x1e\x28"
    b"\x00\x00\x00\x03PLTE\xff\xff\xff\xff\xff\xff\x00\x00\x00\x00IEND\xaeB`\x82"
)


def api_error(response: HttpResponseBase) -> dict[str, str]:
    """The first entry of an API error body, ``{"field", "message", "code"}``.

    Every error the API answers has the exception handler's shape
    (``api/views/exception_handler.py``), ``{"errors": [entry, ...]}``. A DRF
    ``Response`` from a view called directly is not rendered yet, so its
    ``data`` is read instead of its content.
    """
    data = getattr(response, "data", None)
    body = data if data is not None else json.loads(response.content)
    errors = body["errors"]
    assert errors, response.content
    return errors[0]


def create_password():
    return secrets.token_urlsafe(10)


def create_user_details(is_admin=False):
    return {
        "username": fake.user_name(),
        "first_name": fake.first_name(),
        "last_name": fake.last_name(),
        "email": fake.email(),
        "password": create_password(),
        "is_superuser": is_admin,
    }


def create_test_person(
    name: str | None = None,
    kind: str | None = Person.KIND_USER,
    cover_photo: Photo | None = None,
    cover_face: Face | None = None,
    face_count: int = 0,
    cluster_owner: User | None = None,
    **kwargs: Any,
) -> Person:
    """Create a test Person object with random data using Faker."""
    return Person.objects.create(
        name=name or fake.name(),
        kind=kind,
        cover_photo=cover_photo,
        cover_face=cover_face,
        face_count=face_count,
        cluster_owner=cluster_owner,
        **kwargs,
    )


def create_test_person_group(
    owner: User,
    name: str | None = None,
    persons: Iterable[Person] = (),
    **kwargs: Any,
) -> PersonGroup:
    """A group of people for ``owner`` holding ``persons``. Names are unique per
    owner (in any letter case), so the default is random."""
    name = name or f"{fake.word()}-{uuid.uuid4().hex[:8]}"
    group = PersonGroup.objects.create(owner=owner, name=name, **kwargs)
    group.persons.add(*persons)
    return group


def create_test_face(
    photo: Photo | None = None,
    image: str | None = "test.jpg",
    person: Person | None = None,
    classification_person: Person | None = None,
    classification_probability: float = 0.0,
    cluster_person: Person | None = None,
    cluster_probability: float = 0.0,
    deleted: bool = False,
    cluster: Cluster | None = None,
    location_top: int = 0,
    location_bottom: int = 0,
    location_left: int = 0,
    location_right: int = 0,
    encoding: str | None = None,
    **kwargs: Any,
) -> Face:
    """Create a test Face object with random data using Faker."""
    return Face.objects.create(
        photo=photo,
        image=image,
        person=person,
        classification_person=classification_person,
        classification_probability=classification_probability
        or fake.pyfloat(min_value=0, max_value=1),
        cluster_person=cluster_person,
        cluster_probability=cluster_probability
        or fake.pyfloat(min_value=0, max_value=1),
        deleted=deleted,
        cluster=cluster,
        location_top=location_top or fake.random_int(min=0, max=500),
        location_bottom=location_bottom or fake.random_int(min=501, max=1000),
        location_left=location_left or fake.random_int(min=0, max=500),
        location_right=location_right or fake.random_int(min=501, max=1000),
        encoding=encoding or np.random.rand(128).tobytes().hex(),
        **kwargs,
    )


def create_test_user(
    is_admin=False,
    public_sharing=False,
    password: str | None = None,
    **kwargs: Any,
) -> User:
    """A user with random details; any User field can be given by keyword.

    A ``password`` is hashed, as ``User.objects.create_user`` does, so the user can
    log in with it. Without one the stored value is random and nobody logs in as it.
    """
    # Ensure unique username by appending UUID
    username = fake.user_name() + str(uuid.uuid4())[:8]
    fields: dict[str, Any] = {
        "username": username,
        "first_name": fake.first_name(),
        "last_name": fake.last_name(),
        "email": fake.email(),
        "password": create_password(),
        "public_sharing": public_sharing,
        "is_superuser": is_admin,
        "is_staff": is_admin,
    }
    fields.update(kwargs)
    user = User(**fields)
    if password is not None:
        user.set_password(password)
    user.save(force_insert=True)
    return user


def create_test_stack(owner: User, **kwargs: Any) -> PhotoStack:
    """A photo stack for ``owner``. Add its photos with ``stack.photos.add``."""
    return PhotoStack.objects.create(owner=owner, **kwargs)


def create_test_duplicate(owner: User, **kwargs: Any) -> Duplicate:
    """A duplicate group for ``owner``. Add its photos with ``duplicate.photos.add``."""
    return Duplicate.objects.create(owner=owner, **kwargs)


def create_test_tag(owner: User, name: str | None = None, **kwargs: Any) -> Tag:
    """A tag for ``owner``. Names are unique per owner, so the default is random."""
    name = name or f"{fake.word()}-{uuid.uuid4().hex[:8]}"
    return Tag.objects.create(owner=owner, name=name, **kwargs)


def create_test_album_user(
    owner: User, title: str | None = None, **kwargs: Any
) -> AlbumUser:
    """A user album for ``owner``. Titles are unique per owner, so the default is random."""
    title = title or f"{fake.catch_phrase()} {uuid.uuid4().hex[:8]}"
    return AlbumUser.objects.create(owner=owner, title=title, **kwargs)


def create_test_album_collection(
    owner: User,
    name: str | None = None,
    albums: Iterable[AlbumUser] = (),
    **kwargs: Any,
) -> AlbumCollection:
    """An album collection for ``owner`` holding ``albums``. Names are unique per
    owner (in any letter case), so the default is random."""
    name = name or f"{fake.word()}-{uuid.uuid4().hex[:8]}"
    collection = AlbumCollection.objects.create(owner=owner, name=name, **kwargs)
    collection.albums.add(*albums)
    return collection


def create_test_album_date(
    owner: User, date: datetime.date | None = None, **kwargs: Any
) -> AlbumDate:
    """A date album for ``owner``. Without a date it is undated (NULL dates may repeat)."""
    return AlbumDate.objects.create(owner=owner, date=date, **kwargs)


def create_test_job(
    started_by: User,
    job_type: int = LongRunningJob.JOB_SCAN_PHOTOS,
    **kwargs: Any,
) -> LongRunningJob:
    """A background job started by ``started_by``, queued now, with a fresh job id."""
    kwargs.setdefault("job_id", str(uuid.uuid4()))
    kwargs.setdefault("queued_at", timezone.now())
    return LongRunningJob.objects.create(
        started_by=started_by, job_type=job_type, **kwargs
    )


def create_test_upgrade_task_state(key: str, **kwargs: Any) -> UpgradeTaskState:
    """The row of the post-upgrade task ``key`` (``api.jobs.upgrade_tasks``), made now."""
    return UpgradeTaskState.objects.create(key=key, **kwargs)


def create_test_cluster(owner: User, **kwargs: Any) -> Cluster:
    """A face cluster for ``owner``, with a random 128-dimension mean encoding."""
    kwargs.setdefault("mean_face_encoding", np.random.rand(128).tobytes().hex())
    return Cluster.objects.create(owner=owner, **kwargs)


def create_test_album_auto(
    owner: User, timestamp: datetime.datetime | None = None, **kwargs: Any
) -> AlbumAuto:
    """An event album for ``owner``, with its photos added by ``album.photos.add``.

    ``(timestamp, owner)`` is unique, so the default timestamp is a random moment
    in the last ten years. The title is the model's default unless given.
    """
    if timestamp is None:
        timestamp = timezone.now() - datetime.timedelta(
            microseconds=secrets.randbelow(10 * 365 * 24 * 3600 * 10**6)
        )
    kwargs.setdefault("created_on", timezone.now())
    return AlbumAuto.objects.create(owner=owner, timestamp=timestamp, **kwargs)


def create_test_album_thing(
    owner: User, title: str | None = None, thing_type: str | None = None, **kwargs: Any
) -> AlbumThing:
    """A thing album (a subject such as "dog") for ``owner``.

    Titles are unique per owner and type, so the default title is random.
    """
    title = title or f"{fake.word()}-{uuid.uuid4().hex[:8]}"
    return AlbumThing.objects.create(
        owner=owner, title=title, thing_type=thing_type, **kwargs
    )


def create_test_album_place(
    owner: User, title: str | None = None, **kwargs: Any
) -> AlbumPlace:
    """A place album for ``owner``. Titles are unique per owner, so the default is random."""
    title = title or f"{fake.city()} {uuid.uuid4().hex[:8]}"
    return AlbumPlace.objects.create(owner=owner, title=title, **kwargs)


def create_test_metadata_edit(
    photo: Photo,
    field_name: str,
    created_at: datetime.datetime | None = None,
    **kwargs: Any,
) -> MetadataEdit:
    """An edit of ``field_name`` in the photo's edit history, by its owner.

    ``created_at`` backdates it (the column is ``auto_now_add``), so tests can
    order edits made within the same clock tick.
    """
    kwargs.setdefault("user", photo.owner)
    edit = MetadataEdit.objects.create(photo=photo, field_name=field_name, **kwargs)
    if created_at is not None:
        MetadataEdit.objects.filter(pk=edit.pk).update(created_at=created_at)
        edit.created_at = created_at
    return edit


def create_test_thumbnail(photo: Photo, **kwargs: Any) -> Thumbnail:
    """The thumbnail row of ``photo``, with image paths under its image hash.

    ``create_test_photo`` already makes one, so call this only for a photo built
    without it. A photo has at most one thumbnail (its primary key is the photo).
    """
    image_hash = photo.image_hash
    fields: dict[str, Any] = {
        "aspect_ratio": 1,
        "thumbnail_big": f"thumbnails_big/{image_hash}.webp",
        "square_thumbnail": f"square_thumbnails/{image_hash}.webp",
        "square_thumbnail_small": f"square_thumbnails_small/{image_hash}.webp",
        "dominant_color": None,
    }
    fields.update(kwargs)
    return Thumbnail.objects.create(photo=photo, **fields)


def create_test_photo(**kwargs):
    """A photo owned by ``kwargs["owner"]``, with a main file, a thumbnail and the given fields.

    ``main_file`` (a File row) is used as the main file instead of a new one.
    ``image_hash`` is the main file's hash. A new file is written to TEST_MEDIA_ROOT.
    Caption, search and metadata fields are split into their own models.
    """
    from api.models.photo_caption import PhotoCaption
    from api.models.photo_metadata import PhotoMetadata
    from api.models.photo_search import PhotoSearch

    # Use proper UUID for primary key (Photo model now uses UUIDField)
    pk = uuid.uuid4()
    main_file: File | None = kwargs.pop("main_file", None)
    if main_file is None:
        # Use unique content per photo so each File gets a unique hash (primary key)
        unique_content = ONE_PIXEL_PNG + pk.bytes
        main_file = create_test_file(
            os.path.join(TEST_MEDIA_ROOT, f"{pk.hex}.png"),
            kwargs["owner"],
            unique_content,
        )
    # image_hash is the content hash of the main file, as the scanner sets it
    image_hash = main_file.hash

    # Extract fields that are no longer part of Photo model
    aspect_ratio = kwargs.pop("aspect_ratio", 1)
    is_video = kwargs.get("video", False)
    square_ext = ".mp4" if is_video else ".webp"
    thumbnail_big = kwargs.pop("thumbnail_big", f"thumbnails_big/{image_hash}.webp")
    square_thumbnail = kwargs.pop(
        "square_thumbnail", f"square_thumbnails/{image_hash}{square_ext}"
    )
    square_thumbnail_small = kwargs.pop(
        "square_thumbnail_small", f"square_thumbnails_small/{image_hash}{square_ext}"
    )
    dominant_color = kwargs.pop("dominant_color", None)

    # Extract caption and search fields
    captions_json = kwargs.pop("captions_json", None)
    search_captions = kwargs.pop("search_captions", None)
    search_location = kwargs.pop("search_location", None)

    # Extract metadata fields that are now in PhotoMetadata model
    # Map old field names to new PhotoMetadata field names
    metadata_field_mapping = {
        "camera": "camera_model",  # Old 'camera' -> new 'camera_model'
        "lens": "lens_model",  # Old 'lens' -> new 'lens_model'
        "iso": "iso",
        "fstop": "aperture",  # Old 'fstop' -> new 'aperture'
        "focal_length": "focal_length",
        "shutter_speed": "shutter_speed",
        "focalLength35Equivalent": "focal_length_35mm",
        "digitalZoomRatio": "digital_zoom_ratio",
        "subjectDistance": "subject_distance",
        "width": "width",
        "height": "height",
        "orientation": "orientation",
        "gps_altitude": "gps_altitude",
        # Also support new field names directly
        "camera_make": "camera_make",
        "camera_model": "camera_model",
        "lens_make": "lens_make",
        "lens_model": "lens_model",
        "aperture": "aperture",
        "focal_length_35mm": "focal_length_35mm",
        "serial_number": "serial_number",
    }
    # The coordinates live on the photo itself (#2252).
    for old_name, photo_field in (
        ("gps_lat", "exif_gps_lat"),
        ("gps_latitude", "exif_gps_lat"),
        ("gps_lon", "exif_gps_lon"),
        ("gps_longitude", "exif_gps_lon"),
    ):
        if old_name in kwargs:
            kwargs[photo_field] = kwargs.pop(old_name)
    metadata_fields = {}
    for old_name, new_name in metadata_field_mapping.items():
        if old_name in kwargs:
            value = kwargs.pop(old_name)
            if new_name is not None:  # Skip fields that don't exist in new model
                metadata_fields[new_name] = value

    # A photo in the trash has a trashed_at, as trash_photos would set it.
    if kwargs.get("in_trashcan") and "trashed_at" not in kwargs:
        kwargs["trashed_at"] = timezone.now()

    # Create the photo with remaining kwargs
    photo = Photo(pk=pk, image_hash=image_hash, **kwargs)
    photo.main_file = main_file
    if "added_on" not in kwargs.keys():
        photo.added_on = timezone.now()
    photo.save()

    create_test_thumbnail(
        photo,
        aspect_ratio=aspect_ratio,
        thumbnail_big=thumbnail_big,
        square_thumbnail=square_thumbnail,
        square_thumbnail_small=square_thumbnail_small,
        dominant_color=dominant_color,
    )

    # Create PhotoCaption if captions_json is provided
    if captions_json is not None:
        PhotoCaption.objects.create(photo=photo, captions_json=captions_json)

    # Create PhotoSearch if search fields are provided, folded as the app
    # folds them whenever it writes either field.
    if search_captions is not None or search_location is not None:
        search_row = PhotoSearch(
            photo=photo,
            search_captions=search_captions,
            search_location=search_location,
        )
        search_row.refresh_search_folded()
        search_row.save()

    # Create PhotoMetadata if metadata fields are provided
    if metadata_fields:
        PhotoMetadata.objects.create(photo=photo, **metadata_fields)

    return photo


def create_test_photos(number_of_photos=1, **kwargs):
    """``number_of_photos`` photos built by ``create_test_photo`` with the same keyword arguments."""
    return [create_test_photo(**kwargs) for _ in range(0, number_of_photos)]


def create_test_photos_with_faces(number_of_photos=1, **kwargs):
    """Photos as ``create_test_photos`` builds them, each with one face (``create_test_face``)."""
    photos = create_test_photos(number_of_photos, **kwargs)
    [create_test_face(photo=photo) for photo in photos]
    return photos


def create_test_file(
    path: str | None,
    user: User | None = None,
    content: bytes | None = None,
    *,
    on_disk: bool = False,
    file_type: int = File.IMAGE,
    missing: bool = False,
    hash_value: str | None = None,
    **fields: Any,
) -> File:
    """A File row, hashed the way the app hashes a file (MD5 plus the owner id).

    Without ``content`` and ``on_disk`` only the row is created, at ``path``
    (default ``/photos/<random>.jpg``), with a random content hash (``hash_value``
    sets it, and ``user`` may then be None: the row has no owner); ``file_type``
    and ``missing`` apply to this form only, and so do ``fields``, other File
    columns such as ``type=`` that replace the defaults. With ``content``, or with
    ``on_disk=True`` (which writes distinct bytes), the bytes are written to
    ``path`` (default: a new file in TEST_MEDIA_ROOT) and the row takes their hash;
    these forms need ``user``.
    """
    if content is None and not on_disk:
        owner_part = "" if user is None else str(user.id)
        row: dict[str, Any] = {
            "path": path or f"/photos/{uuid.uuid4().hex}.jpg",
            "hash": hash_value or f"{secrets.token_hex(16)}{owner_part}",
            "type": file_type,
            "missing": missing,
        }
        row.update(fields)
        return File.objects.create(**row)
    if fields:
        raise TypeError("File fields other than the defaults need the row-only form")
    if user is None:
        raise ValueError("a File with content or on disk needs its owner")
    if path is None:
        path = os.path.join(TEST_MEDIA_ROOT, f"{uuid.uuid4().hex}.jpg")
    if content is None:
        content = ONE_PIXEL_PNG + secrets.token_bytes(16)
    with open(path, "wb+") as f:
        f.write(content)
    return get_or_create_file(path, user)


def share_test_photos(photo_ids, user):
    """Share photos with a user.

    Args:
        photo_ids: Can be either photo UUIDs (pk) or image_hashes (for backward compatibility)
        user: The user to share photos with
    """
    # Handle both UUID (pk) and image_hash inputs for backward compatibility
    resolved_ids = []
    for photo_id in photo_ids:
        if isinstance(photo_id, uuid.UUID):
            resolved_ids.append(photo_id)
        elif isinstance(photo_id, str):
            # Try to find photo by image_hash
            try:
                photo = Photo.objects.get(image_hash=photo_id)
                resolved_ids.append(photo.pk)
            except Photo.DoesNotExist:
                # Maybe it's a UUID string
                try:
                    resolved_ids.append(uuid.UUID(photo_id))
                except ValueError:
                    raise ValueError(f"Could not resolve photo_id: {photo_id}")
        else:
            resolved_ids.append(photo_id)

    Photo.shared_to.through.objects.bulk_create(
        [
            Photo.shared_to.through(user_id=user.id, photo_id=photo_id)
            for photo_id in resolved_ids
        ]
    )


# A globally routable address standing in for the Nextcloud server.
PUBLIC_TEST_IP = "93.184.215.14"


def patch_nextcloud_dns(resolves=None, default=PUBLIC_TEST_IP):
    """Patch the DNS lookup of nextcloud.server_address, keeping tests offline.

    ``resolves`` maps a host name to the addresses it resolves to; an empty list
    makes the lookup fail. A literal IP resolves to itself and any other host to
    ``default``.
    """
    import ipaddress
    import socket
    from unittest import mock

    resolves = resolves or {}

    def fake_getaddrinfo(host, port, *args, **kwargs):
        addresses = resolves.get(host)
        if addresses is None:
            try:
                ipaddress.ip_address(host)
                addresses = [host]
            except ValueError:
                addresses = [default]
        if not addresses:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        return [
            (
                socket.AF_INET6 if ":" in address else socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (address, port),
            )
            for address in addresses
        ]

    return mock.patch(
        "nextcloud.server_address.socket.getaddrinfo", side_effect=fake_getaddrinfo
    )


def write_hanging_tool(directory: str, seconds: int = 60) -> str:
    """An executable in ``directory`` that ignores its arguments and sleeps.

    It sleeps in a child process, holding the tool's stdout and stderr, as the
    Windows exiftool.exe launcher does with its perl.exe: killing only the tool
    would leave the pipes open. Returns its path, for a patched binaries.resolve.
    """
    if os.name == "nt":
        path = os.path.join(directory, "hanging_tool.bat")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(
                f'@"{sys.executable}" -c "import time; time.sleep({seconds})"\r\n'
            )
        return path
    path = os.path.join(directory, "hanging_tool")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(f"#!/bin/sh\nsleep {seconds}\n")
    os.chmod(path, 0o755)
    return path
