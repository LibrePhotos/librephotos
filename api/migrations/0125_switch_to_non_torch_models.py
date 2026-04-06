from django.db import migrations


def switch_to_non_torch_models(apps, schema_editor):
    try:
        Constance = apps.get_model("constance", "Constance")
    except LookupError:
        return

    updates = {
        "CAPTIONING_MODEL": {"im2txt", "blip_base_capfilt_large", "moondream"},
        "TAGGING_MODEL": {"places365", "siglip2"},
    }
    desired_values = {
        "CAPTIONING_MODEL": "moondream",
        "TAGGING_MODEL": "siglip2",
    }

    for key, allowed_values in updates.items():
        row = Constance.objects.filter(key=key).first()
        if row is None:
            Constance.objects.create(key=key, value=f'"{desired_values[key]}"')
            continue

        current_value = str(row.value).strip().strip('"').strip("'")
        if current_value in allowed_values and current_value != desired_values[key]:
            row.value = f'"{desired_values[key]}"'
            row.save(update_fields=["value"])

class Migration(migrations.Migration):
    dependencies = [
        ("api", "0124_photo_local_orientation"),
    ]

    operations = [
        migrations.RunPython(switch_to_non_torch_models, migrations.RunPython.noop),
    ]
