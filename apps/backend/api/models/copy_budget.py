from django.db import models

from api.models.user import User


class CopyBudget(models.Model):
    """How many new copies without metadata one user had made this hour
    through albums and shared people (#464, #668).

    The count a library share keeps on its share row (``copies_hour``,
    ``copies_made``), for readers who have no share row: in the database, so
    every worker process sees the same count.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="copy_budget"
    )
    hour = models.DateTimeField(null=True, blank=True)
    made = models.PositiveIntegerField(default=0)

    def __str__(self) -> str:
        return f"{self.made} copies for user {self.user_id} at {self.hour}"
