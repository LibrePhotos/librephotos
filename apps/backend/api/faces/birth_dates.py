"""Face suggestions leave out the people born after a photo was taken (#2752).

A person's birth date is optional (#2750). Training still learns every person;
only the suggestion for an unlabelled face skips the people who were not born
yet when its photo was taken. Labelling a face by hand is not restricted.
"""

from __future__ import annotations

import datetime
from collections.abc import Collection, Iterable, Mapping, Sequence
from typing import TYPE_CHECKING

from api.models import Face, Person
from api.models.user import User

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

# Photo times are wall clock tagged as UTC, and a birth date has no zone: a
# day of slack keeps a photo from the birth day itself in.
BIRTH_DATE_SLACK = datetime.timedelta(days=1)


def birth_dates_of(user: User) -> dict[int, datetime.date]:
    """The birth dates of the user's people that have one, by person id"""
    people = Person.objects.owned_by(user).filter(birth_date__isnull=False)
    return {
        person_id: born
        for person_id, born in people.values_list("id", "birth_date")
        if born is not None
    }


def photo_dates_of_faces(face_ids: Iterable[int]) -> dict[int, datetime.datetime]:
    """When the photo of each face was taken, by face id; undated photos are left out"""
    faces = Face.objects.filter(id__in=face_ids, photo__exif_timestamp__isnull=False)
    return {
        face_id: taken
        for face_id, taken in faces.values_list("id", "photo__exif_timestamp")
        if taken is not None
    }


def unborn_people(
    birth_dates: Mapping[int, datetime.date], taken: datetime.datetime | None
) -> frozenset[int]:
    """The people born after ``taken`` (with a day of slack); none for an undated photo"""
    if taken is None:
        return frozenset()
    latest_birth = taken.date() + BIRTH_DATE_SLACK
    return frozenset(
        person_id for person_id, born in birth_dates.items() if born > latest_birth
    )


def without_unborn(
    classes: Sequence[int],
    probabilities: Sequence[float] | npt.NDArray[float64],
    unborn: Collection[int],
) -> list[float]:
    """``probabilities`` with the classes of the ``unborn`` people at 0"""
    return [
        0.0 if int(person_id) in unborn else float(probability)
        for person_id, probability in zip(classes, probabilities)
    ]
