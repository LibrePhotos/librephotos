"""Person groups (#1126): which of a user's groups a person is in."""

from collections.abc import Iterable

from django.db import transaction
from django.utils import timezone

from api.models.person import Person
from api.models.person_group import PersonGroup


@transaction.atomic
def set_person_groups(person: Person, groups: Iterable[PersonGroup]) -> list[int]:
    """Put ``person`` in exactly ``groups``; answer their ids in order.

    The caller resolves both against the requester (owned person, owned
    groups), so a person never lands in someone else's group. Each group that
    gained or lost the person gets a new ``last_modified``.
    """
    wanted = {group.pk for group in groups}
    current = set(person.groups.values_list("pk", flat=True))
    person.groups.set(wanted)
    changed = wanted ^ current
    if changed:
        PersonGroup.objects.filter(pk__in=changed).update(last_modified=timezone.now())
    return sorted(wanted)
