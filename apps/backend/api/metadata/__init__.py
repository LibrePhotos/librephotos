"""Metadata reading, writing and tag constants.

Submodules:

- ``tags``: tag name constants (the ``Tags`` class)
- ``reader``: ``get_metadata()`` and sidecar file helpers
- ``writer``: ``write_metadata()`` and ``read_orientation()``
- ``face_regions``: face region coordinate conversion and tag building
- ``photo_datetime``: a photo's capture time and the day album that follows from it
- ``photo_writer``: writing a photo's edits back to its file or XMP sidecar
- ``jobs``: background rating writes for changes made without ``Photo.save()``

Import directly from the submodules, which avoids circular imports::

    from api.metadata.tags import Tags
    from api.metadata.reader import get_metadata
"""
