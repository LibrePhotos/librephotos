"""The signed-in user of a request, typed as ``User``.

``request.user`` is ``User | AnonymousUser``. Views behind ``IsAuthenticated``
(the default permission class) never see the anonymous user, but the type
checker cannot know that. ``request_user`` narrows it and fails the request
with 401 if a view is ever reached anonymously, instead of letting an
``AnonymousUser`` flow into owner filters.

Views that do serve anonymous requests narrow by hand with
``isinstance(request.user, User)``; ``is_anonymous`` and ``is_authenticated``
do not narrow the type. ``scope_user`` narrows an anonymous user to ``None``,
which the photo scopes take.
"""

from django.http import HttpRequest
from rest_framework.exceptions import NotAuthenticated
from rest_framework.request import Request

from api.models.user import User


def request_user(request: HttpRequest | Request) -> User:
    user = request.user
    if not isinstance(user, User):
        raise NotAuthenticated()
    return user


def scope_user(request: Request) -> User | None:
    """The requester as ``Photo.objects.owned_by`` and ``visible_to`` take it.

    ``request.user`` is typed ``AbstractBaseUser | AnonymousUser``, which the
    photo scopes do not accept. Both treat ``None`` exactly as an anonymous
    user, so a view that serves anonymous readers (or whose schema is built
    with an anonymous mock request) passes this instead of raising.
    """
    user = request.user
    return user if isinstance(user, User) else None
