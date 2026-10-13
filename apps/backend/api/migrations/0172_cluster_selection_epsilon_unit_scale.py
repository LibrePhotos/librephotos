"""Move each user's Cluster Selection Epsilon to the unit-length scale (#1996).

Face clustering now compares encodings scaled to length 1, so two faces are 0
to 2 apart. The old choices (0.025 to 0.2) sat far below every distance and
changed nothing; the new ones keep their labels:

    Off 0 -> 0, Small 0.025 -> 0.9, Normal 0.05 -> 0.95,
    High 0.1 -> 1.0, Very High 0.2 -> 1.05

Another value under 0.5 was set through the API on the old scale and gets the
choice nearest to it; one above 2 (on the scale of the unscaled ArcFace
encodings) would merge everything and becomes Very High. Reversing maps the
five choices back.
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

OLD_TO_NEW = {0.0: 0.0, 0.025: 0.9, 0.05: 0.95, 0.1: 1.0, 0.2: 1.05}
VERY_HIGH = 1.05


def new_epsilon(old: float) -> float | None:
    """The epsilon on the unit scale, or None to keep ``old``."""
    if old <= 0:
        return 0.0
    if old < 0.5:
        nearest = min(OLD_TO_NEW, key=lambda choice: abs(choice - old))
        return OLD_TO_NEW[nearest]
    if old > 2:
        return VERY_HIGH
    return None


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    User = apps.get_model("api", "User")
    for user in User.objects.only("id", "cluster_selection_epsilon"):
        epsilon = new_epsilon(user.cluster_selection_epsilon)
        if epsilon is not None and epsilon != user.cluster_selection_epsilon:
            User.objects.filter(id=user.id).update(cluster_selection_epsilon=epsilon)


def backwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    User = apps.get_model("api", "User")
    for old, new in OLD_TO_NEW.items():
        if new:
            User.objects.filter(cluster_selection_epsilon=new).update(
                cluster_selection_epsilon=old
            )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0171_shown_photo_size"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="cluster_selection_epsilon",
            field=models.FloatField(default=0.95),
        ),
        migrations.RunPython(forwards, backwards),
    ]
