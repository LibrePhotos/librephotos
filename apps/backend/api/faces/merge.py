"""Merging two people into one (#2206).

The same person can end up under two names: a typo, a nickname, two clusters
labelled separately. A merge moves everything of one person (the source) to
the other (the target) and deletes the source; the target keeps its name and
cover. The target joins every group the source was in.
"""

from dataclasses import dataclass

from django.db import transaction

from api.faces.labels import relabel_faces
from api.models.cluster import Cluster
from api.models.face import Face
from api.models.person import Person
from api.models.user import User


@dataclass(frozen=True)
class MergeResult:
    """What ``merge_people`` moved."""

    moved: int
    photo_count: int
    write_queued: bool


def merge_people(user: User, source: Person, target: Person) -> MergeResult:
    """Move every face of ``source`` to ``target``, then delete ``source``.

    Only ``user``'s own faces and clusters move. A face of the source on
    another user's photo loses its person when the source is deleted
    (``on_delete=SET_NULL``), as it would on a plain delete. The face tag
    write-back is queued: a merge moves all of a person's photos at once.
    """
    if source.pk == target.pk:
        raise ValueError("A person cannot be merged into themselves")
    with transaction.atomic():
        result = relabel_faces(
            user,
            Face.objects.owned_by(user).filter(person=source),
            target,
            queue_write=True,
        )
        # The suggestions too, or the merged faces would still be proposed as
        # someone who no longer exists (the delete would only clear them).
        owned_faces = Face.objects.owned_by(user)
        owned_faces.filter(cluster_person=source).update(cluster_person=target)
        owned_faces.filter(classification_person=source).update(
            classification_person=target
        )
        Cluster.objects.owned_by(user).filter(person=source).update(person=target)
        # The merged person's groups too (#1126): both are the user's people,
        # so the groups are the user's.
        target.groups.add(*source.groups.all())
        # The sync tombstone is written by the pre_delete receiver.
        source.delete()
    return MergeResult(
        moved=len(result.faces),
        photo_count=len(result.photos),
        write_queued=result.write_queued,
    )
