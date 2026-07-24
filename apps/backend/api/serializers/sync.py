"""Flat, cheap serializers for the mobile-v2 delta-sync feeds (doc 04 §3).

These deliberately avoid DRF ``ModelSerializer`` machinery: every feed is built
from a ``.values()``/annotated queryset and each row is turned into a plain dict
by a module-level function. No per-row DB access, no N+1. The output columns
mirror the client's ``remote_*`` tables (doc 02 §1).
"""


def to_ms(dt):
    """UTC datetime -> integer milliseconds since epoch, or None."""
    if dt is None:
        return None
    return int(dt.timestamp() * 1000)


def dominant_hex(raw):
    """Thumbnail.dominant_color is stored as ``"[r, g, b]"``; emit ``#rrggbb``."""
    if not raw:
        return None
    try:
        inner = raw[1:-1]
        r, g, b = (int(x) for x in inner.split(", "))
        return "#%02x%02x%02x" % (r, g, b)
    except (ValueError, TypeError, IndexError):
        return None


def _video_length_ms(raw):
    if not raw:
        return None
    try:
        return int(float(raw) * 1000)
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------- #
# Photo summary
# --------------------------------------------------------------------------- #
# Field list consumed by the delta photo view's ``.values(*PHOTO_VALUES)`` call.
PHOTO_VALUES = (
    "id",
    "image_hash",
    "owner_id",
    "timestamp",
    "added_on",
    "last_modified",
    "video",
    "video_length",
    "rating",
    "hidden",
    "in_trashcan",
    "removed",
    "public",
    "exif_gps_lat",
    "exif_gps_lon",
    "thumbnail__aspect_ratio",
    "thumbnail__dominant_color",
    "search_instance__search_location",
    "owner__favorite_min_rating",
)


def serialize_photo_row(row):
    """Turn one ``.values()`` dict (annotated with ``has_motion``) into a
    flat wire dict matching the client's ``remote_photo`` columns."""
    min_rating = row.get("owner__favorite_min_rating") or 0
    if row["video"]:
        media_type = "video"
    elif row.get("has_motion"):
        media_type = "motion"
    else:
        media_type = "image"
    return {
        "id": str(row["id"]),
        "image_hash": row["image_hash"],
        "owner_id": row["owner_id"],
        "timestamp": to_ms(row["timestamp"]),
        "added_on": to_ms(row["added_on"]),
        "last_modified": to_ms(row["last_modified"]),
        "type": media_type,
        "video_length_ms": _video_length_ms(row["video_length"]),
        "rating": row["rating"],
        "is_favorite": bool(min_rating and row["rating"] >= min_rating),
        "hidden": bool(row["hidden"]),
        "in_trashcan": bool(row["in_trashcan"]),
        "removed": bool(row["removed"]),
        "is_public": bool(row["public"]),
        "aspect_ratio": row["thumbnail__aspect_ratio"],
        "latitude": row["exif_gps_lat"],
        "longitude": row["exif_gps_lon"],
        "search_location": row["search_instance__search_location"] or "",
        "dominant_color": dominant_hex(row["thumbnail__dominant_color"]),
    }


# --------------------------------------------------------------------------- #
# Person
# --------------------------------------------------------------------------- #
PERSON_VALUES = (
    "id",
    "name",
    "kind",
    "face_count",
    "cover_photo__image_hash",
    "last_modified",
)


def serialize_person_row(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "face_count": row["face_count"],
        "cover_photo_hash": row["cover_photo__image_hash"],
        "last_modified": to_ms(row["last_modified"]),
    }


# --------------------------------------------------------------------------- #
# Albums
# --------------------------------------------------------------------------- #
USER_ALBUM_VALUES = (
    "id",
    "title",
    "owner_id",
    "favorited",
    "cover_photo__image_hash",
    "created_on",
    "last_modified",
)


def serialize_user_album_row(row, photo_ids, shared):
    return {
        "id": row["id"],
        "title": row["title"],
        "owner_id": row["owner_id"],
        "favorited": bool(row["favorited"]),
        "shared": int(shared),
        "cover_hash": row["cover_photo__image_hash"],
        "photo_count": len(photo_ids),
        "created_on": to_ms(row["created_on"]),
        "last_modified": to_ms(row["last_modified"]),
        "photo_ids": photo_ids,
    }


AUTO_ALBUM_VALUES = (
    "id",
    "title",
    "timestamp",
    "favorited",
    "last_modified",
)


def serialize_auto_album_row(row, photo_ids, cover_hash):
    return {
        "id": row["id"],
        "title": row["title"],
        "timestamp": to_ms(row["timestamp"]),
        "favorited": bool(row["favorited"]),
        "photo_count": len(photo_ids),
        "cover_hash": cover_hash,
        "last_modified": to_ms(row["last_modified"]),
        "photo_ids": photo_ids,
    }


# Thing / place / tag: mirror only the list (photo_count + cover hashes), not
# membership (doc 02 §1).
def serialize_named_album_row(row, cover_hashes, extra=None):
    out = {
        "id": row["id"],
        "title": row["title"],
        "photo_count": row["photo_count"],
        "cover_hashes": cover_hashes,
        "last_modified": to_ms(row["last_modified"]),
    }
    if extra:
        out.update(extra)
    return out


# --------------------------------------------------------------------------- #
# Sharing surface (shared_user rows)
# --------------------------------------------------------------------------- #
SHARED_USER_VALUES = (
    "id",
    "username",
    "first_name",
    "last_name",
    "avatar",
    "last_modified",
)


def serialize_shared_user_row(row):
    avatar = row.get("avatar")
    return {
        "id": row["id"],
        "username": row["username"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "avatar_url": (f"/media/{avatar}" if avatar else None),
        "last_modified": to_ms(row["last_modified"]),
    }
