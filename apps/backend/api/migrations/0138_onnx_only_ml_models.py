"""Move site settings off the retired PyTorch models.

Places365, im2txt and BLIP are gone (with PyTorch itself). A site that had
one of them selected is moved to its ONNX successor: Places365 to
MobileCLIP-S2, im2txt and BLIP to Florence-2 base (int8). The retired
taggers' AlbumThing rows are removed too: nothing can regenerate them, and
they would otherwise sit next to the new tagger's albums as stale duplicates
of the same titles. Their tags stay in ``captions_json`` under their old key,
which nothing reads any more but which costs nothing to keep.
"""

from django.db import migrations

RETIRED_CAPTIONING_MODELS = ("im2txt", "blip_base_capfilt_large")
NEW_CAPTIONING_MODEL = "florence2_base_int8"

RETIRED_TAGGING_MODEL = "places365"
NEW_TAGGING_MODEL = "mobileclip_s2"
RETIRED_THING_TYPES = ("places365_attribute", "places365_category")


def _constance_value(model_name):
    # django-constance stores JSON-encoded values for the database backend.
    return f'"{model_name}"'


def forwards(apps, schema_editor):
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        Constance = None

    if Constance is not None:
        Constance.objects.filter(
            key="CAPTIONING_MODEL",
            value__in=[_constance_value(m) for m in RETIRED_CAPTIONING_MODELS],
        ).update(value=_constance_value(NEW_CAPTIONING_MODEL))
        Constance.objects.filter(
            key="TAGGING_MODEL", value=_constance_value(RETIRED_TAGGING_MODEL)
        ).update(value=_constance_value(NEW_TAGGING_MODEL))

    AlbumThing = apps.get_model("api", "AlbumThing")
    AlbumThing.objects.filter(thing_type__in=RETIRED_THING_TYPES).delete()


def backwards(apps, schema_editor):
    """The old models cannot come back; only the settings are reversible."""
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        return
    Constance.objects.filter(
        key="CAPTIONING_MODEL", value=_constance_value(NEW_CAPTIONING_MODEL)
    ).update(value=_constance_value("im2txt"))
    Constance.objects.filter(
        key="TAGGING_MODEL", value=_constance_value(NEW_TAGGING_MODEL)
    ).update(value=_constance_value(RETIRED_TAGGING_MODEL))


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0137_photo_ocr_source_dimensions"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
