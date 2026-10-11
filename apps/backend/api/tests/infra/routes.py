"""Walk the URL configuration for tests that hold every route to a rule.

Shared by the tests that must notice a new endpoint on their own: the
cross-tenant write test (every mutating route needs a case), the API
conventions test (every router prefix pins its verbs) and the permission
tests built on them. Keep it small and free of test-specific policy: it only
says which routes exist and which methods they answer.

* ``api_routes()`` - every ``api/`` URL pattern with the HTTP methods its
  view answers.
* ``mutating_api_routes()`` - the same, narrowed to POST/PUT/PATCH/DELETE.
* ``router_verbs(router)`` - per registered router prefix, the
  ``"METHOD action"`` pairs the router actually serves.
"""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.routers import SimpleRouter

MUTATING_METHODS = frozenset({"post", "put", "patch", "delete"})
# Answered by every view (HEAD follows GET in Django's View.setup); they say
# nothing about which actions a route serves.
IMPLICIT_METHODS = frozenset({"head", "options", "trace"})


@dataclass(frozen=True)
class ApiRoute:
    """One URL pattern: its normalised route, view class and HTTP methods."""

    route: str
    view: type
    methods: frozenset[str]


def normalise(route: str) -> str:
    """A regex or path route as a plain ``api/...`` string."""
    return (
        route.lstrip("^").lstrip("/").rstrip("$").replace("\\.", ".").replace("/?", "/")
    )


def _view_methods(callback: object, view: type) -> frozenset[str]:
    # A viewset route carries its {method: action} map; a plain APIView
    # answers whatever handlers it defines.
    actions = getattr(callback, "actions", None)
    if actions:
        methods = set(actions)
    else:
        names = getattr(view, "http_method_names", ())
        methods = {m for m in names if hasattr(view, m)}
    return frozenset(methods - IMPLICIT_METHODS)


def _walk(
    patterns: Iterable[URLPattern | URLResolver], prefix: str
) -> Iterator[ApiRoute]:
    for pattern in patterns:
        route = prefix + str(pattern.pattern).lstrip("^")
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern.url_patterns, route)
            continue
        callback = pattern.callback
        view = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
        # The router's ``.json`` suffix variants repeat every route.
        if view is None or "(?P<format>" in route:
            continue
        normalised = normalise(route)
        if normalised.startswith("api/"):
            yield ApiRoute(normalised, view, _view_methods(callback, view))


def api_routes() -> list[ApiRoute]:
    """Every ``api/`` route of the project URLconf, in resolution order."""
    return list(_walk(get_resolver().url_patterns, ""))


def mutating_api_routes() -> dict[str, set[str]]:
    """Every api/ route whose view answers POST, PUT, PATCH or DELETE."""
    routes: dict[str, set[str]] = {}
    for api_route in api_routes():
        methods = api_route.methods & MUTATING_METHODS
        if methods:
            routes.setdefault(api_route.route, set()).update(methods)
    return routes


def router_verbs(router: SimpleRouter) -> dict[str, set[str]]:
    """Per registered prefix, the ``"METHOD action"`` pairs the router serves.

    Computed the way the router builds its URLs: each route's method map,
    kept only where the viewset implements the action, and only for methods
    the viewset accepts (``http_method_names``). ``"PATCH partial_update"``
    is served, ``"PUT update"`` only exists if ``update`` does too.
    """
    verbs: dict[str, set[str]] = {}
    for prefix, viewset, _basename in router.registry:
        allowed = {m.lower() for m in viewset.http_method_names}
        served = verbs.setdefault(prefix, set())
        for route in router.get_routes(viewset):
            mapping = router.get_method_map(viewset, route.mapping)
            served.update(
                f"{method.upper()} {action}"
                for method, action in mapping.items()
                if method in allowed
            )
    return verbs
