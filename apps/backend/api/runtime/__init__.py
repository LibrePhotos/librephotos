"""Runtime: the sidecar processes and the external tools the backend relies on.

- ``sidecars``: the sidecars' ports (``SERVICES``) and the one HTTP client the
  backend calls them with; importable without Django, the sidecars read their
  port from it
- ``http_timeouts``: the ``(connect, read)`` timeout of every sidecar call and
  of a model download
- ``supervisor``: starts, stops and watches the sidecar processes (the
  ``check_services`` watchdog, scheduled by ``start_service``), and their
  feature flags
- ``ml_models``: the pinned model files, their download job and checksums
- ``binaries``: the only place an external tool (ffmpeg, ffprobe, ExifTool, ...)
  is started

This file imports nothing, so ``api.runtime.sidecars`` stays importable
without Django (the ``django-free`` import contract in ``pyproject.toml``).
"""
