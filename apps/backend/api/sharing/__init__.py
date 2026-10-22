"""Sharing a whole library read-only with other users (#2731).

- ``grants``: what a recipient sees of each of the owner's photos, and the
  one redaction every photo serializer applies to a library photo.
- ``library_photos``: the owner's photos as the recipient's library page,
  timeline and search reach them.
- ``copies``: the metadata-free full-size copies a recipient downloads when
  the owner does not share original files.
"""
