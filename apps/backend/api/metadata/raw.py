"""Every tag of a photo's files, for its owner's "All metadata" view (#2277).

Read from the files on request through the exif service and never stored:
the main file first, then each XMP sidecar the scan reads, highest priority
first. Paths go out relative to the owner's library folder, never absolute.
"""

from __future__ import annotations

import logging
import os.path
from typing import TYPE_CHECKING, Literal, TypedDict

from api.metadata.reader import (
    MetadataFileMissingError,
    all_tags,
    sidecar_files_for_photo,
)
from api.photos.paths import library_of, path_label

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


class RawMetadataFile(TypedDict):
    path_label: str
    kind: Literal["media", "sidecar"]
    groups: list[dict[str, object]]


class RawMetadata(TypedDict):
    """``GET /api/photos/<photo_id>/metadata/raw/``."""

    files: list[RawMetadataFile]


class MainFileMissingError(MetadataFileMissingError):
    """The photo has no main file, or it is not on disk."""


def raw_metadata(photo: Photo) -> RawMetadata:
    """Every tag of *photo*'s main file and of each of its sidecars.

    Raises ``MainFileMissingError`` when the main file is gone and
    ``MetadataReadError`` when the exif service cannot read a file. A sidecar
    that disappears between the listing and the read is left out.
    """
    main_file = photo.main_file
    if main_file is None or not os.path.isfile(main_file.path):
        logger.info("photo %s: no main file on disk for the raw metadata", photo.id)
        raise MainFileMissingError("the photo's file is not on disk")
    # The library folder holding the photo (#123); its sidecars sit beside it.
    root = library_of(photo.owner).root_of(main_file.path)
    try:
        main_groups = all_tags(main_file.path)
    except MetadataFileMissingError as error:
        raise MainFileMissingError(str(error)) from error
    files: list[RawMetadataFile] = [
        {
            "path_label": path_label(main_file.path, root),
            "kind": "media",
            "groups": main_groups,
        }
    ]
    # sidecar_files_for_photo lists the sidecar that wins last; show it first.
    for sidecar in reversed(sidecar_files_for_photo(photo)):
        try:
            groups = all_tags(sidecar)
        except MetadataFileMissingError:
            continue
        files.append(
            {
                "path_label": path_label(sidecar, root),
                "kind": "sidecar",
                "groups": groups,
            }
        )
    return {"files": files}
