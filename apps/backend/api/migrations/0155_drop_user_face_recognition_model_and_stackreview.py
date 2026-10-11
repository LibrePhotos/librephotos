"""Drop two leftovers nothing reads or writes any more (#2219).

``User.face_recognition_model`` chose between dlib's HOG and CNN detectors.
Face models have been a site setting (constance ``FACE_RECOGNITION_MODEL``)
since 0125, and the user API never exposed the column.

``StackReview`` was meant to record review decisions on duplicate stacks.
Duplicates are reviewed through ``Duplicate.review_status`` instead, so no
code path ever created a row; its only reader was a restore hook that reset
rows that could not exist. Nothing references the table, so dropping it takes
no other table with it.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0154_metadata_edit_json_encoder"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="user",
            name="face_recognition_model",
        ),
        migrations.DeleteModel(
            name="StackReview",
        ),
    ]
