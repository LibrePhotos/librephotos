"""Make OpenCLIP ViT-B/32 the only image-text model.

MobileCLIP-S2 (Apple's research-only licence), SigLIP 2 and CLIP ViT-B/32 are
gone; OpenCLIP ViT-B/32 (LAION's DataComp-XL weights, MIT) makes the tags, the
semantic-search embeddings and similar photos (api.semantic_search).

- The TAGGING_MODEL and SEMANTIC_SEARCH_MODEL site settings are gone with the
  choice they offered; their stored values are deleted.
- The retired taggers' tags are removed from ``captions_json`` and their tag
  albums (``<model>_tag`` AlbumThing rows) deleted, as 0138 did for Places365:
  nothing can regenerate them, and they would sit next to OpenCLIP's albums as
  stale duplicates of the same titles.
- Embeddings stay where they are. ``build_similarity_index`` (container start)
  queues the Calculate CLIP embeddings job for every user whose photos carry
  another model's embedding (``clip_embeddings_model`` not OpenCLIP, NULL
  included), which re-embeds them in place and, with tagging on, re-tags them
  from the same image-tower run, rebuilding the similarity index as it goes.
  The index files on disk are deleted here, so until a library's first rebuild
  semantic search finds nothing rather than comparing OpenCLIP queries with
  another model's vectors.
- The retired models' directories under ``data_models`` are removed: only
  those names, a link only as a link, and each one logged.
"""

import logging
import os
import re
import shutil
from pathlib import Path

from django.conf import settings
from django.db import migrations

logger = logging.getLogger(__name__)

RETIRED_SETTINGS = ("TAGGING_MODEL", "SEMANTIC_SEARCH_MODEL")
RETIRED_TAG_KEYS = ("mobileclip_s2", "siglip2")
RETIRED_THING_TYPES = tuple(f"{key}_tag" for key in RETIRED_TAG_KEYS)
RETIRED_MODEL_DIRS = ("mobileclip_s2", "siglip2", "clip_vit_b32")
INDEX_FILE = re.compile(r"^\d+\.npz$")
FILE_ATTRIBUTE_REPARSE_POINT = 0x400


def _drop_retired_settings(apps):
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        return
    Constance.objects.filter(key__in=RETIRED_SETTINGS).delete()


def _drop_retired_tags_sql(vendor, cursor):
    """Remove the retired keys from every captions_json in one statement."""
    if vendor == "postgresql":
        cursor.execute(
            "UPDATE api_photo_caption SET captions_json = captions_json - %s::text[]"
            " WHERE captions_json ?| %s::text[]",
            [list(RETIRED_TAG_KEYS), list(RETIRED_TAG_KEYS)],
        )
        return True
    if vendor == "sqlite":
        paths = [f"$.{key}" for key in RETIRED_TAG_KEYS]
        removes = ", ".join("%s" for _ in paths)
        present = " OR ".join("json_type(captions_json, %s) IS NOT NULL" for _ in paths)
        cursor.execute(
            f"UPDATE api_photo_caption SET captions_json = json_remove(captions_json,"
            f" {removes}) WHERE captions_json IS NOT NULL AND ({present})",
            paths + paths,
        )
        return True
    return False


def drop_retired_tags(PhotoCaption, batch_size=1000):
    """Remove the retired keys row by row (databases without the SQL above)."""
    rows = PhotoCaption.objects.filter(
        captions_json__has_any_keys=list(RETIRED_TAG_KEYS)
    ).only("pk", "captions_json")
    pending = []
    for caption in rows.iterator(chunk_size=batch_size):
        for key in RETIRED_TAG_KEYS:
            caption.captions_json.pop(key, None)
        pending.append(caption)
        if len(pending) >= batch_size:
            PhotoCaption.objects.bulk_update(pending, ["captions_json"])
            pending = []
    if pending:
        PhotoCaption.objects.bulk_update(pending, ["captions_json"])


def _is_link(path):
    """A symlink, or a Windows junction (which is_symlink() does not report)."""
    if path.is_symlink():
        return True
    attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    return bool(attributes & FILE_ATTRIBUTE_REPARSE_POINT)


def remove_retired_model_dirs(models_root=None):
    """Delete the retired models' directories; returns the paths removed.

    Only the known names, and a link (or junction) is unlinked, never followed:
    whatever it points at may belong to someone else.
    """
    root = Path(models_root or Path(settings.MEDIA_ROOT) / "data_models")
    removed = []
    for name in RETIRED_MODEL_DIRS:
        path = root / name
        if not os.path.lexists(path):
            continue
        try:
            if _is_link(path):
                try:
                    os.unlink(path)
                except OSError:
                    os.rmdir(path)  # a directory link or junction on Windows
            elif path.is_dir():
                shutil.rmtree(path)
            else:
                continue
        except OSError as error:
            logger.warning(f"Could not remove the retired model {path}: {error}")
            continue
        logger.info(f"Removed the retired model directory {path}")
        removed.append(path)
    return removed


def remove_similarity_indices(index_root=None):
    """Delete the per-user similarity index files; returns the paths removed.

    They hold the earlier model's vectors, which OpenCLIP's queries cannot be
    compared with. Every index is rebuilt from the database.
    """
    root = Path(index_root or Path(settings.MEDIA_ROOT) / "similarity")
    if not root.is_dir():
        return []
    removed = []
    for path in root.iterdir():
        if not INDEX_FILE.match(path.name) or not path.is_file():
            continue
        try:
            path.unlink()
        except OSError as error:
            logger.warning(f"Could not remove the similarity index {path}: {error}")
            continue
        removed.append(path)
    if removed:
        logger.info(f"Removed {len(removed)} similarity index file(s) from {root}")
    return removed


def forwards(apps, schema_editor):
    _drop_retired_settings(apps)

    AlbumThing = apps.get_model("api", "AlbumThing")
    AlbumThing.objects.filter(thing_type__in=RETIRED_THING_TYPES).delete()

    PhotoCaption = apps.get_model("api", "PhotoCaption")
    connection = schema_editor.connection if schema_editor else None
    done = False
    if connection is not None:
        with connection.cursor() as cursor:
            done = _drop_retired_tags_sql(connection.vendor, cursor)
    if not done:
        drop_retired_tags(PhotoCaption)

    remove_similarity_indices()
    remove_retired_model_dirs()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0151_photo_clip_embeddings_model"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
