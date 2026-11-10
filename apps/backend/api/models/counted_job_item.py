from django.db import models


class CountedJobItem(models.Model):
    """An item a job's progress already counts: a photo, a file group, a batch.

    The broker hands a task out again when its lease runs out
    (``api.jobs.broker``), also one whose worker had already counted it. A
    per-item task counted twice overshot the job's progress and finished the
    job, with its follow-ups, before its work was done. Counting an item
    writes its row here in the same transaction
    (``api.directory_watcher.utils.update_scan_counter``), so the second
    delivery counts nothing. The rows of an ended job are dropped
    (``api.jobs.cleanup``).
    """

    job_id = models.CharField(max_length=36)
    item = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["job_id", "item"], name="counted_job_item_once"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item} of job {self.job_id}"
