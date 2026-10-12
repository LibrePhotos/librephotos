"""Walk the URL configuration for tests that hold every route to a rule.

Shared by the tests that must notice a new endpoint on their own: the
cross-tenant write test (every mutating route needs a case or an exact
exemption), the API conventions test (every router prefix pins its verbs) and
the permission tests built on them. Keep it small and free of test-specific
policy: it only says which routes exist and which methods they answer.

* ``api_routes()`` - every class-based ``api/`` URL pattern with the HTTP
  methods its view answers, and the view function and URL keyword arguments
  to call it with directly.
* ``function_routes()`` - every ``api/`` URL pattern served by a plain
  function view. The URLconf does not say which methods such a view accepts,
  so a caller has to treat each one as possibly mutating.
* ``drop_verified_format_twins(routes)`` - removes the router's ``.json``
  style format-suffix copies, and only those that have a plain twin with the
  same handler. Any other format route stays in the walk.
* ``router_verbs(router)`` - per registered router prefix, the
  ``"METHOD action"`` pairs the router actually serves.
"""

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field

from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.routers import SimpleRouter

MUTATING_METHODS = frozenset({"post", "put", "patch", "delete"})
# Answered by every view (HEAD follows GET in Django's View.setup); they say
# nothing about which actions a route serves.
IMPLICIT_METHODS = frozenset({"head", "options", "trace"})
# The suffix DRF's format_suffix_patterns() adds to a route, and the group
# that marks it. A route with the group but without a plain twin is no copy.
FORMAT_SUFFIX = ".(?P<format>[a-z0-9]+)"


@dataclass(frozen=True)
class ApiRoute:
    """One URL pattern: its normalised route, view class and HTTP methods.

    ``callback`` is the view function the resolver calls and ``kwargs`` the
    names of the keyword arguments the URL hands it. ``pattern`` is the
    URLPattern itself, whose own regex or route string a test can read.
    """

    route: str
    view: type
    methods: frozenset[str]
    callback: Callable[..., object] | None = field(default=None, compare=False)
    kwargs: tuple[str, ...] = ()
    pattern: URLPattern | None = field(default=None, compare=False, repr=False)

    @property
    def module(self) -> str:
        return self.view.__module__


@dataclass(frozen=True)
class FunctionRoute:
    """One URL pattern served by a plain function view."""

    route: str
    callback: Callable[..., object]
    kwargs: tuple[str, ...] = ()
    pattern: URLPattern | None = field(default=None, compare=False, repr=False)

    @property
    def module(self) -> str:
        return str(getattr(self.callback, "__module__", "") or "")


Route = ApiRoute | FunctionRoute


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


def _url_kwargs(pattern: URLPattern | URLResolver) -> tuple[str, ...]:
    return tuple(pattern.pattern.regex.groupindex)


def _walk(
    patterns: Iterable[URLPattern | URLResolver],
    prefix: str,
    outer_kwargs: tuple[str, ...] = (),
) -> Iterator[Route]:
    for pattern in patterns:
        route = prefix + str(pattern.pattern).lstrip("^")
        kwargs = outer_kwargs + _url_kwargs(pattern)
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern.url_patterns, route, kwargs)
            continue
        normalised = normalise(route)
        if not normalised.startswith("api/"):
            continue
        callback = pattern.callback
        view = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
        if view is None:
            yield FunctionRoute(normalised, callback, kwargs, pattern)
        else:
            yield ApiRoute(
                normalised,
                view,
                _view_methods(callback, view),
                callback,
                kwargs,
                pattern,
            )


def _same_handler(plain: Route, copy: Route) -> bool:
    if isinstance(plain, ApiRoute) and isinstance(copy, ApiRoute):
        return plain.view is copy.view and plain.methods == copy.methods
    return (
        isinstance(plain, FunctionRoute)
        and isinstance(copy, FunctionRoute)
        and plain.callback is copy.callback
    )


def drop_verified_format_twins(routes: list[Route]) -> list[Route]:
    """Drop each format-suffix route that has a plain twin with the same handler.

    ``api/user.(?P<format>[a-z0-9]+)/`` is a copy of ``api/user/`` when the
    plain route serves the same view class (or the same function) with the
    same methods. A format route without such a twin is kept, so it is walked
    and held to the rules like any other route.
    """
    plain_by_route: dict[str, list[Route]] = {}
    for route in routes:
        if "(?P<format>" not in route.route:
            plain_by_route.setdefault(route.route, []).append(route)

    kept: list[Route] = []
    for route in routes:
        if "(?P<format>" in route.route:
            plain_key = route.route.replace(FORMAT_SUFFIX, "")
            twins = plain_by_route.get(plain_key, [])
            if any(_same_handler(twin, route) for twin in twins):
                continue
        kept.append(route)
    return kept


def _all_routes() -> list[Route]:
    return drop_verified_format_twins(list(_walk(get_resolver().url_patterns, "")))


def api_routes() -> list[ApiRoute]:
    """Every class-based ``api/`` route of the project URLconf, in resolution order."""
    return [route for route in _all_routes() if isinstance(route, ApiRoute)]


def function_routes() -> list[FunctionRoute]:
    """Every ``api/`` route served by a plain function view, in resolution order."""
    return [route for route in _all_routes() if isinstance(route, FunctionRoute)]


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
