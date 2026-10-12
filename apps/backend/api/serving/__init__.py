"""Serving files: what the backend needs to hand media bytes to a client.

- ``http_range``: byte ranges for the files Django serves itself (installs
  without the bundled nginx)
- ``permissions``: why the web server could not read an original (the media
  error header and the serving diagnostics endpoint)

The views that serve media are in ``api.views.media``.
"""
