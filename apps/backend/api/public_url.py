"""Working out the public, browser-reachable base URL of this installation.

The reverse proxy forwards ``/api/`` and ``/media/`` to the backend with the
Host header rewritten to ``backend`` (see deploy/docker/proxy/nginx.conf), which
is deliberate: ``ALLOWED_HOSTS`` only lists ``localhost`` and ``BACKEND_HOST``, so
Django's host validation passes no matter what domain the user actually browses
to. The cost is that ``request.build_absolute_uri()`` on an ``/api/`` request
yields ``http://backend/...`` — a name only resolvable inside the Docker network.

So anything that hands a URL to the outside world (a link in an email, an OAuth
``redirect_uri`` the browser must follow) has to be told the public origin rather
than inferring it from the request.
"""

import os

from django.conf import settings


def _internal_hosts():
    """Host names the proxy substitutes for ``/api/`` requests.

    A base URL pointing at one of these is reachable only from inside the Docker
    network, so it cannot be handed to a browser. ``localhost`` is deliberately
    *not* included: for a single-machine install it is a perfectly good public
    origin.
    """
    return {"backend", os.environ.get("BACKEND_HOST", "backend")}


def public_base_url(request=None):
    """Return the public base URL (no trailing slash), or ``""`` if unknown.

    Prefers the explicitly configured ``FRONTEND_BASE_URL``. Falls back to the
    origin the request arrived on, which is correct for a direct-to-Django
    deployment and wrong behind the standard proxy — hence the caller-visible
    empty-string case for "could not determine a public URL".
    """
    configured = (settings.FRONTEND_BASE_URL or "").rstrip("/")
    if configured:
        return configured
    if request is None:
        return ""
    return request.build_absolute_uri("/").rstrip("/")


def is_internal_base_url(base_url):
    """Whether ``base_url`` points somewhere only the Docker network can reach."""
    if not base_url:
        return True
    without_scheme = base_url.split("://", 1)[-1]
    host = without_scheme.split("/", 1)[0].split(":", 1)[0]
    return host in _internal_hosts()
