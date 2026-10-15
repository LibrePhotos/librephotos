"""Metadata reading, writing and tag constants.

Submodules:

- ``tags``: tag name constants (the ``Tags`` class)
- ``reader``: ``get_metadata()`` and sidecar file helpers
- ``writer``: ``write_metadata()``, ``read_orientation()`` and ``read_shown_orientation()``
- ``orientation``: composing an EXIF orientation with a rotation or flip
- ``face_regions``: face region coordinate conversion and tag building
- ``photo_datetime``: a photo's capture time and the day album that follows from it
- ``photo_reader``: reading a photo's file metadata into ``Photo`` and ``PhotoMetadata`` (the scan's metadata step)
- ``photo_writer``: writing a photo's edits back to its file or XMP sidecar
- ``jobs``: background rating writes for bulk rating edits
- ``date_rules_job``: the job that applies the current date rules to the photos already in the library
- ``exposure_time_job``: the job that reads the shutter speeds an older version stored wrongly again

Import directly from the submodules, which avoids circular imports::

    from api.metadata.tags import Tags
    from api.metadata.reader import get_metadata
"""
