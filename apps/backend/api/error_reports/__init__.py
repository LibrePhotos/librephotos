"""Opt-in error reporting (#2938).

The backend's errors (``capture``) and the web app's (forwarded to the backend)
are scrubbed (``scrub``) and saved in ``ErrorReport`` (``store``). Nothing
leaves the server until an admin picks a server in the ``ERROR_REPORTING`` site
setting or sends a saved report from the Error reports page (``send``).
"""
