"""The signed-in user of a request, typed as ``User``.

``request.user`` is ``User | AnonymousUser``. Views behind ``IsAuthenticated``
(the default permission class) never see the anonymous user, but the type
checker cannot know that. ``request_user`` narrows it and fails the request
with 401 if a view is ever reached anonymously, instead of letting an
``AnonymousUser`` flow into owner filters.

Views that do serve anonymous requests narrow by hand with
``isinstance(request.user, User)``; ``is_anonymous`` and ``is_authenticated``
do not narrow the type.
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
