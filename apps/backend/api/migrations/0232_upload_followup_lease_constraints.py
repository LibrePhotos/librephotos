"""The upload follow-up lease's states, as constraints.

A lease holder always has an expiry and the other way round, and ``dirty``
is only set under a lease. No code path writes anything else; a row that
holds it anyway is made free first, which loses nothing: a free lease is
taken by the next run.
"""

from django.db import migrations, models


def free_inconsistent_leases(apps, schema_editor):
    UploadFollowupState = apps.get_model("api", "UploadFollowupState")
    no_holder = models.Q(lease_holder="")
    no_expiry = models.Q(lease_expires_at__isnull=True)
    UploadFollowupState.objects.filter(
        (no_holder & (~no_expiry | models.Q(dirty=True))) | (~no_holder & no_expiry)
    ).update(lease_holder="", lease_expires_at=None, dirty=False)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0231_job_items_and_queue_seen"),
    ]

    operations = [
        migrations.RunPython(free_inconsistent_leases, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="uploadfollowupstate",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("lease_expires_at__isnull", True), ("lease_holder", "")),
                    models.Q(
                        models.Q(("lease_holder", ""), _negated=True),
                        ("lease_expires_at__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="upload_followup_lease_holder_and_expiry",
            ),
        ),
        migrations.AddConstraint(
            model_name="uploadfollowupstate",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("dirty", False),
                    models.Q(("lease_holder", ""), _negated=True),
                    _connector="OR",
                ),
                name="upload_followup_dirty_under_lease",
            ),
        ),
    ]
