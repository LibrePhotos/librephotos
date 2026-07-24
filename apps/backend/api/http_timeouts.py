"""Timeouts for HTTP requests to in-container service sidecars.

`requests` defaults to no timeout, which means a stalled sidecar (e.g.
face-recognition wedged on a pathological image, or exiftool hung
mid-process) blocks the caller indefinitely. In practice this surfaces
as long-running scan jobs that show as "running" forever with no
progress — the worker is parked on a socket read that never returns.

Each constant below is a ``(connect_timeout, read_timeout)`` tuple
suitable for passing as ``timeout=`` to ``requests.{get,post,delete}``.
Connect timeouts are uniformly small because the sidecars are local
sockets; read timeouts vary with what the operation can legitimately
take on a slow but functioning server.
"""

CONNECT_TIMEOUT = 5

HEALTH_CHECK = (CONNECT_TIMEOUT, 5)
EXIF = (CONNECT_TIMEOUT, 30)
FACE = (CONNECT_TIMEOUT, 60)
SIMILARITY = (CONNECT_TIMEOUT, 60)
TAGS = (CONNECT_TIMEOUT, 60)
THUMBNAIL = (CONNECT_TIMEOUT, 120)
CLIP_EMBED = (CONNECT_TIMEOUT, 120)
CAPTION = (CONNECT_TIMEOUT, 180)
OCR = (CONNECT_TIMEOUT, 180)
LLM_GEN = (CONNECT_TIMEOUT, 300)
