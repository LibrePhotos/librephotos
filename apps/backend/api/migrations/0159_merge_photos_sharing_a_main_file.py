"""Merge the Photo rows a repeated Nextcloud scan made of one file (#2257).

Every Nextcloud scan handed each downloaded file to ``create_new_image``, which
built a new Photo even when the user already had one for that path. A user who
scanned three times has three Photo rows per file: one owner, one ``main_file``,
one ``image_hash``, each processed on its own and each open to edits.

This folds every group of the user's photos that share a main file into one,
like 0115 did for photos sharing a hash, and leaves everything else alone. The
kept row is the one not in the trash, then the one with the most recorded
metadata edits, then the oldest. It keeps its own caption, date, location,
title and other per-photo values; from the others it takes:

* the highest rating, and public if any of them was public;
* every relation: album, event, tag and thing memberships, covers, shares,
  stacks, duplicate groups, metadata edit history, and a one-to-one row
  (public link, caption, OCR text) the kept row does not have;
* faces: a face at the same box as one of the kept row's faces is the same
  face found again, so one is dropped, the labelled one winning; any other
  face moves over.

Counts stored next to those relations (tag and thing photo counts, person face
counts) are recomputed, a stack or duplicate group left with fewer than two
photos is removed, and each dropped row gets a tombstone for the sync clients.

Self-contained on purpose: a migration must not import application code that
may move or change after it ships.
"""

from django.db import migrations, transaction
from django.db.models import Count

VISIBLE = {"hidden": False, "in_trashcan": False, "removed": False}


def _box(face):
    return (
        face.location_top,
        face.location_bottom,
        face.location_left,
        face.location_right,
    )


def _merge_faces(Face, Person, keep, merge_ids, touched_people):
    kept = {_box(face): face for face in Face.objects.filter(photo_id=keep.pk)}
    # Of two copies of one face the labelled one stays, whichever comes first.
    for face in Face.objects.filter(photo_id__in=merge_ids).order_by("pk"):
        touched_people.update(
            pid
            for pid in (
                face.person_id,
                face.classification_person_id,
                face.cluster_person_id,
            )
            if pid
        )
        twin = kept.get(_box(face))
        if twin is not None and (twin.person_id or not face.person_id):
            Person.objects.filter(cover_face_id=face.pk).update(cover_face_id=twin.pk)
            continue  # deleted with its photo
        if twin is not None:
            Person.objects.filter(cover_face_id=twin.pk).update(cover_face_id=face.pk)
            twin.delete()
        Face.objects.filter(pk=face.pk).update(photo_id=keep.pk)
        kept[_box(face)] = face


def _merge_many_to_many(through, photo_field, other_field, keep, merge_ids):
    other_id = other_field + "_id"
    have = set(
        through.objects.filter(**{photo_field + "_id": keep.pk}).values_list(
            other_id, flat=True
        )
    )
    new = []
    for value in through.objects.filter(
        **{photo_field + "_id__in": merge_ids}
    ).values_list(other_id, flat=True):
        if value not in have:
            have.add(value)
            new.append(through(**{photo_field + "_id": keep.pk, other_id: value}))
    through.objects.bulk_create(new)


def _merge_relations(Photo, keep, merge_ids):
    # Photo's own many-to-many fields: files, stacks, duplicates, shared_to.
    for field in Photo._meta.many_to_many:
        _merge_many_to_many(
            field.remote_field.through,
            field.m2m_field_name(),
            field.m2m_reverse_field_name(),
            keep,
            merge_ids,
        )
    for rel in Photo._meta.related_objects:
        if rel.many_to_many:
            # Albums, events, tags, things and their covers.
            _merge_many_to_many(
                rel.through,
                rel.field.m2m_reverse_field_name(),
                rel.field.m2m_field_name(),
                keep,
                merge_ids,
            )
        elif rel.one_to_one:
            rows = rel.related_model.objects
            name = rel.field.name
            if not rows.filter(**{name: keep.pk}).exists():
                first = rows.filter(**{name + "__in": merge_ids}).first()
                if first is not None:
                    rows.filter(pk=first.pk).update(**{name: keep.pk})
        elif rel.related_model._meta.model_name != "face":
            rel.related_model.objects.filter(
                **{rel.field.name + "__in": merge_ids}
            ).update(**{rel.field.name: keep.pk})


def _related_ids(through, photo_field, other_field, photo_ids):
    return set(
        through.objects.filter(**{photo_field + "_id__in": photo_ids}).values_list(
            other_field + "_id", flat=True
        )
    )


def _refresh_counts(apps, tag_ids, thing_ids, person_ids, stack_ids, duplicate_ids):
    Tag = apps.get_model("api", "Tag")
    AlbumThing = apps.get_model("api", "AlbumThing")
    Person = apps.get_model("api", "Person")
    PhotoStack = apps.get_model("api", "PhotoStack")
    Duplicate = apps.get_model("api", "Duplicate")
    Photo = apps.get_model("api", "Photo")
    Face = apps.get_model("api", "Face")

    for tag in Tag.objects.filter(pk__in=tag_ids):
        tag.photo_count = Photo.objects.filter(tags=tag, **VISIBLE).count()
        tag.save(update_fields=["photo_count", "last_modified"])
    for album in AlbumThing.objects.filter(pk__in=thing_ids):
        album.photo_count = Photo.objects.filter(albumthing=album, **VISIBLE).count()
        album.save(update_fields=["photo_count", "last_modified"])
    for person in Person.objects.filter(pk__in=person_ids):
        if person.cluster_owner_id is None:
            continue
        person.face_count = Face.objects.filter(
            person=person,
            deleted=False,
            photo__hidden=False,
            photo__in_trashcan=False,
            photo__owner_id=person.cluster_owner_id,
        ).count()
        person.save(update_fields=["face_count", "last_modified"])
    for model, ids in ((PhotoStack, stack_ids), (Duplicate, duplicate_ids)):
        model.objects.filter(pk__in=ids).annotate(n=Count("photos")).filter(
            n__lt=2
        ).delete()


def merge_photos_sharing_a_main_file(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    Face = apps.get_model("api", "Face")
    Person = apps.get_model("api", "Person")
    DeletionLog = apps.get_model("api", "DeletionLog")

    groups = list(
        Photo.objects.filter(main_file__isnull=False)
        .values("owner_id", "main_file_id")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
        .order_by()
    )
    if not groups:
        return

    m2m = {f.name: f for f in Photo._meta.many_to_many}
    reverse_m2m = {
        f"{rel.related_model._meta.model_name}.{rel.field.name}": rel
        for rel in Photo._meta.related_objects
        if rel.many_to_many
    }

    def ids_of(rel, photo_ids):
        return _related_ids(
            rel.through,
            rel.field.m2m_reverse_field_name(),
            rel.field.m2m_field_name(),
            photo_ids,
        )

    def own_ids_of(name, photo_ids):
        field = m2m[name]
        return _related_ids(
            field.remote_field.through,
            field.m2m_field_name(),
            field.m2m_reverse_field_name(),
            photo_ids,
        )

    merged = 0
    for group in groups:
        photos = list(
            Photo.objects.filter(
                owner_id=group["owner_id"], main_file_id=group["main_file_id"]
            )
            .annotate(edits=Count("metadata_edits"))
            .order_by("in_trashcan", "-edits", "added_on", "pk")
        )
        if len(photos) < 2:
            continue
        keep, rest = photos[0], photos[1:]
        merge_ids = [p.pk for p in rest]
        group_ids = [keep.pk, *merge_ids]

        with transaction.atomic():
            tag_ids = ids_of(reverse_m2m["tag.photos"], group_ids)
            thing_ids = ids_of(reverse_m2m["albumthing.photos"], group_ids)
            stack_ids = own_ids_of("stacks", group_ids)
            duplicate_ids = own_ids_of("duplicates", group_ids)
            viewers = {
                pk: set(own_ids_of("shared_to", [pk])) | {group["owner_id"]}
                for pk in merge_ids
            }
            person_ids = set(
                Face.objects.filter(photo_id__in=group_ids)
                .exclude(person_id=None)
                .values_list("person_id", flat=True)
            )

            _merge_faces(Face, Person, keep, merge_ids, person_ids)
            _merge_relations(Photo, keep, merge_ids)

            keep.rating = max(p.rating for p in photos)
            keep.public = any(p.public for p in photos)
            keep.save(update_fields=["rating", "public", "last_modified"])

            Photo.objects.filter(pk__in=merge_ids).delete()
            DeletionLog.objects.bulk_create(
                DeletionLog(entity="photo", entity_id=str(pk), owner_id=owner_id)
                for pk, owners in viewers.items()
                for owner_id in owners
            )
            _refresh_counts(
                apps, tag_ids, thing_ids, person_ids, stack_ids, duplicate_ids
            )
        merged += len(merge_ids)

    print(f"Merged {merged} Photo rows into the photo of their file.")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0158_move_scheduled_check_services"),
    ]

    operations = [
        migrations.RunPython(
            merge_photos_sharing_a_main_file, migrations.RunPython.noop
        ),
    ]
