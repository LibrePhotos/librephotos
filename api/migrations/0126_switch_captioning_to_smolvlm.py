from django.db import migrations


def _normalize_constance_value(value):
    return str(value).strip().strip('"').strip("'").lower()


def switch_captioning_to_smolvlm(apps, schema_editor):
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        return

    caption_row = Constance.objects.filter(key="CAPTIONING_MODEL").first()
    if caption_row is None:
        Constance.objects.create(key="CAPTIONING_MODEL", value='"smolvlm-256m"')
    else:
        current_value = _normalize_constance_value(caption_row.value)
        if current_value in {"", "moondream", "im2txt", "blip_base_capfilt_large"}:
            caption_row.value = '"smolvlm-256m"'
            caption_row.save(update_fields=["value"])

    llm_row = Constance.objects.filter(key="LLM_MODEL").first()
    if llm_row is None:
        return

    current_llm_value = _normalize_constance_value(llm_row.value)
    if current_llm_value == "moondream":
        llm_row.value = '"None"'
        llm_row.save(update_fields=["value"])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0125_switch_to_non_torch_models"),
    ]

    operations = [
        migrations.RunPython(
            switch_captioning_to_smolvlm, migrations.RunPython.noop
        ),
    ]
