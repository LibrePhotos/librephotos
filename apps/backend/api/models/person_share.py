from __future__ import annotations

from django.db import models

from api.models.person import Person
from api.models.photo import Photo
from api.models.scopes import OwnedQuerySet
from api.models.user import User


class PersonShareQuerySet(OwnedQuerySet["PersonShare"]):
    """Scoped to the person's owner through ``person__cluster_owner``."""

    owner_lookup = "person__cluster_owner"


class PersonShare(models.Model):
    """A person (#668) shared with another user, who may only look.

    The recipient sees the photos of the person their owner approved
    (``PersonSharePhoto``), never a photo the person was only suggested on.
    """

    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="shares")
    recipient = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="received_person_shares"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = PersonShareQuerySet.as_manager()

    class Meta:
        unique_together = (("person", "recipient"),)

    def __str__(self) -> str:
        return f"Person {self.person_id} shared with {self.recipient_id}"


class PersonSharePhotoQuerySet(OwnedQuerySet["PersonSharePhoto"]):
    """Scoped to the person's owner through ``person__cluster_owner``."""

    owner_lookup = "person__cluster_owner"


class PersonSharePhoto(models.Model):
    """The owner's decision on one photo of a shared person (#668).

    A photo labelled with the person and no row here waits for the owner's
    review; the people the person is shared with see only approved ones.
    """

    APPROVED = "approved"
    DECLINED = "declined"
    STATUS_CHOICES = ((APPROVED, "Approved"), (DECLINED, "Declined"))

    person = models.ForeignKey(
        Person, on_delete=models.CASCADE, related_name="share_photos"
    )
    photo = models.ForeignKey(
        Photo, on_delete=models.CASCADE, related_name="person_share_photos"
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    decided_at = models.DateTimeField(auto_now=True)

    objects = PersonSharePhotoQuerySet.as_manager()

    class Meta:
        unique_together = (("person", "photo"),)

    def __str__(self) -> str:
        return f"Photo {self.photo_id} of person {self.person_id}: {self.status}"
