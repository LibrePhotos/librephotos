"""Thumbnails: rendering them, decoding the original, and their metadata.

- ``render``: the static thumbnails, the video thumbnails, and the dominant
  colour, aspect ratio and perceptual hash read from them
- ``decoding``: decoding an original with pyvips, Pillow filling in the
  formats the bundled libvips lacks
- ``metadata``: stripping the original's metadata from thumbnails written
  before it was dropped

``api.models.thumbnail`` holds the ``Thumbnail`` model and its file paths.
"""
