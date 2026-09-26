"""The address the workers reach the sidecars on.

The sidecars listen on IPv4 only: 0.0.0.0 in the containers, 127.0.0.1 in the
standalone build. ``localhost`` resolves to ``::1`` first, and Windows retries a
refused connection for about two seconds before it falls back to 127.0.0.1, so
every sidecar request on a native Windows install took two seconds longer than
the work it asked for - several times per photo during a scan.
"""

SIDECAR_URL = "http://127.0.0.1"


def sidecar_url(port, path=""):
    return f"{SIDECAR_URL}:{port}{path}"
