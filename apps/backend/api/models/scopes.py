"""One way to scope any owned model to a user.

Every model with a user foreign key that the API filters on gets a manager
built from ``OwnedQuerySet`` (or ``SharedOwnedQuerySet`` when it has
``shared_to``), naming its owner column once in ``owner_lookup``. Views and
serializers then write ``Model.objects.owned_by(request.user)`` or
``Model.objects.get_owned(request.user, id=...)`` instead of spelling the
owner keyword, whose name differs per model (``owner``, ``cluster_owner``,
``started_by``, ``photo__owner``). ``api/tests/infra/test_owner_scope_calls.py``
fails on a new inline owner filter.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar, TypeVar

from django.contrib.auth.models import AnonymousUser
from django.db import models
from django.db.models import Q, QuerySet

from api.models.user import User

if TYPE_CHECKING:
    # typing.Self is Python 3.11+; the backend-gpu image runs 3.10.
    from typing import Self

_M = TypeVar("_M", bound=models.Model)


def _account(user: User | AnonymousUser | None) -> User | None:
    """``user`` when it is a signed-in account; ``None`` for anonymous."""
    if isinstance(user, User) and user.is_authenticated:
        return user
    return None


class OwnedQuerySet(QuerySet[_M]):
    """Rows of a model that belong to one user through ``owner_lookup``."""

    owner_lookup: ClassVar[str] = "owner"

    def owner_q(self, user: User, through: str = "") -> Q:
        """``owned_by`` as a ``Q``, for a condition that has to stay inside one
        ``filter()`` call or an annotation's ``filter=`` / ``When``.

        ``through`` is the path from the queried model to this one, e.g.
        ``Photo.objects.owner_q(user, through="photos__")`` on an album, so
        the condition applies to the same joined row as its neighbours.
        """
        return Q(**{f"{through}{self.owner_lookup}": user})

    def owned_by(self, user: User | AnonymousUser | None) -> Self:
        """Rows ``user`` owns; none for ``None`` or an anonymous user."""
        account = _account(user)
        if account is None:
            return self.none()
        return self.filter(self.owner_q(account))

    def get_owned(self, user: User | AnonymousUser | None, **lookup: object) -> _M:
        """``owned_by(user).get(**lookup)``: another user's row raises
        ``DoesNotExist`` exactly like a missing one."""
        return self.owned_by(user).get(**lookup)


class SharedOwnedQuerySet(OwnedQuerySet[_M]):
    """An owned model that its owner can share to other users (``shared_to``)."""

    def owned_or_shared_to(self, user: User | AnonymousUser | None) -> Self:
        """Rows ``user`` owns or that are shared to them, without public rows.

        ``distinct()`` because ``shared_to`` is a many-to-many join.
        """
        account = _account(user)
        if account is None:
            return self.none()
        return self.filter(self.owner_q(account) | Q(shared_to=account)).distinct()
