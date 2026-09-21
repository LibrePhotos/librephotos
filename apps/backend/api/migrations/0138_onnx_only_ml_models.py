"""Move site settings off the retired PyTorch and llama.cpp models.

Places365, im2txt, BLIP, Moondream and Mistral are gone (with PyTorch and
llama.cpp), and Florence-2 never shipped in a release. A site that had one
of the captioners selected is moved to LFM2.5-VL, Places365 to MobileCLIP-S2,
and the LLM_MODEL key is dropped. The retired taggers' AlbumThing rows are
removed too: nothing can regenerate them, and they would otherwise sit next
to the new tagger's albums as stale duplicates of the same titles. Their tags
stay in ``captions_json`` under their old key, which nothing reads any more
but which costs nothing to keep.

The per-user caption switches (``llm_settings``) used to feed the LLM and
now steer the captioner's prompt. They are on by default from here on, so
users who never touched them (their row still holds the old default) are
switched on as well; anyone who changed a switch keeps their choice.
"""

from django.db import migrations

RETIRED_CAPTIONING_MODELS = (
    "im2txt",
    "blip_base_capfilt_large",
    "florence2_base",
    "florence2_base_int8",
    "moondream",
)
NEW_CAPTIONING_MODEL = "lfm2_vl_450m"

OLD_DEFAULT_CAPTION_SETTINGS = {
    "enabled": False,
    "add_person": False,
    "add_location": False,
    "add_keywords": False,
    "add_camera": False,
    "add_lens": False,
    "add_album": False,
    "sentiment": 0,
    "custom_prompt": "",
    "custom_prompt_enabled": False,
}
NEW_DEFAULT_CAPTION_SETTINGS = {
    **OLD_DEFAULT_CAPTION_SETTINGS,
    "enabled": True,
    "add_person": True,
    "add_location": True,
}

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
        Constance.objects.filter(key="LLM_MODEL").delete()
        Constance.objects.filter(
            key="TAGGING_MODEL", value=_constance_value(RETIRED_TAGGING_MODEL)
        ).update(value=_constance_value(NEW_TAGGING_MODEL))

    AlbumThing = apps.get_model("api", "AlbumThing")
    AlbumThing.objects.filter(thing_type__in=RETIRED_THING_TYPES).delete()

    User = apps.get_model("api", "User")
    for user in User.objects.all().iterator():
        if user.llm_settings == OLD_DEFAULT_CAPTION_SETTINGS:
            user.llm_settings = dict(NEW_DEFAULT_CAPTION_SETTINGS)
            user.save(update_fields=["llm_settings"])


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
