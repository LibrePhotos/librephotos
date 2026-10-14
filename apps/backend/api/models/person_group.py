from django.db import models
from django.db.models.functions import Lower

from api.models.scopes import OwnedQuerySet
from api.models.user import User

NAME_MAX_LENGTH = 128


class PersonGroupQuerySet(OwnedQuerySet["PersonGroup"]):
    """Scoped to its owner through ``owner``."""


class PersonGroup(models.Model):
    """A user's own grouping of their people (#1126): "Family", "Work".

    Many-to-many through ``Person.groups``: a person can be in several groups,
    and deleting a group keeps its people. Only the owner's people go in, and
    nobody else sees a group. Not a ``Tag``: that word is the user's photo label
    (``apps/docs/docs/development/glossary.md``).
    """

    name = models.CharField(max_length=NAME_MAX_LENGTH)
    # Private organisation: it goes with its owner rather than to ``deleted``.
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    objects = PersonGroupQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "owner", name="unique_person_group_name"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id or 0}: {self.name}"
