import math
from bisect import bisect_right
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from typing import TypedDict

from django.db.models import Count, QuerySet

from api.models import Photo, User
from api.models.photo_metadata import with_maker

ISO_STOPS = tuple(
    int(stop)
    for stop in (
        "6 8 10 12 16 20 25 32 40 50 64 80 100 125 160 200 250 320 400 500 640 "
        "800 1000 1250 1600 2000 2500 3200 4000 5000 6400 8000 10000 12800 16000 "
        "20000 25600 32000 40000 51200 64000 80000 102400 128000 160000 204800 "
        "256000 320000 409600"
    ).split()
)
ISO_ORIGIN = ISO_STOPS.index(100)

APERTURE_STOPS = tuple(
    (
        "0.7 0.8 0.9 1 1.1 1.2 1.4 1.6 1.8 2 2.2 2.5 2.8 3.2 3.5 4 4.5 5 5.6 6.3 "
        "7.1 8 9 10 11 13 14 16 18 20 22 25 29 32 36 40 45 51 57 64"
    ).split()
)
APERTURE_ORIGIN = APERTURE_STOPS.index("1")

SHUTTER_STOPS = (
    "1/32000",
    "1/16000",
    "1/8000",
    "1/4000",
    "1/2000",
    "1/1000",
    "1/500",
    "1/250",
    "1/125",
    "1/60",
    "1/30",
    "1/15",
    "1/8",
    "1/4",
    "1/2",
    "1 s",
    "2 s",
    "4 s",
    "8 s",
    "15 s",
    "30 s",
    "1 min",
    "2 min",
    "4 min",
    "8 min",
    "15 min",
)
SHUTTER_ORIGIN = SHUTTER_STOPS.index("1 s")

FOCAL_EDGES = tuple(
    int(stop)
    for stop in (
        "0 2 3 4 5 6 7 8 10 12 14 16 18 20 24 28 35 50 70 85 105 135 200 300 400 "
        "600 800"
    ).split()
)


class RankStat(TypedDict):
    label: str
    value: str
    count: int


class CameraStat(RankStat):
    make: str


class RangeBucket(TypedDict):
    label: str
    min: float
    max: float
    count: int


class CameraStats(TypedDict):
    cameras: list[CameraStat]
    lenses: list[RankStat]
    iso: list[RangeBucket]
    aperture: list[RangeBucket]
    focal_length: list[RangeBucket]
    focal_length_35mm: list[RangeBucket]
    shutter_speed: list[RangeBucket]


def _most_common(names: Counter[str]) -> str:
    return min(names.items(), key=lambda item: (-item[1], item[0]))[0]


def _rank_order(row: RankStat) -> tuple[int, str]:
    return (-row["count"], row["label"].lower())


def _model_rows(makers: dict[str, Counter[str]], model: str) -> list[CameraStat]:
    known = {key: names for key, names in makers.items() if key}
    if "" in makers:
        only_make = _most_common(next(iter(known.values()))) if len(known) == 1 else ""
        count = sum(sum(names.values()) for names in makers.values())
        return [
            CameraStat(
                label=with_maker(only_make, model) or model,
                value=model,
                make="",
                count=count,
            )
        ]
    rows = []
    for names in known.values():
        make = _most_common(names)
        rows.append(
            CameraStat(
                label=with_maker(make, model) or model,
                value=model,
                make=make,
                count=sum(names.values()),
            )
        )
    return rows


def _camera_stats(photos: QuerySet[Photo]) -> list[CameraStat]:
    rows = (
        photos.filter(metadata__camera_model__gt="")
        .values_list("metadata__camera_make", "metadata__camera_model")
        .annotate(count=Count("pk"))
        .order_by()
    )
    makers: defaultdict[str, defaultdict[str, Counter[str]]] = defaultdict(
        lambda: defaultdict(Counter)
    )
    models: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for maybe_make, model, count in rows:
        make = maybe_make or ""
        makers[model.lower()][make.strip().lower()][make] += count
        models[model.lower()][model] += count
    cameras = [
        row
        for key, names in models.items()
        for row in _model_rows(makers[key], _most_common(names))
    ]
    return sorted(cameras, key=lambda row: (*_rank_order(row), row["make"].lower()))


def _lens_stats(photos: QuerySet[Photo]) -> list[RankStat]:
    rows = (
        photos.filter(metadata__lens_model__gt="")
        .values_list("metadata__lens_model")
        .annotate(count=Count("pk"))
        .order_by()
    )
    lenses: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for lens, count in rows:
        lenses[lens.lower()][lens] += count
    stats = []
    for names in lenses.values():
        lens = _most_common(names)
        stats.append(RankStat(label=lens, value=lens, count=sum(names.values())))
    return sorted(stats, key=_rank_order)


def _stop_index(
    value: float, base: float, per_stop: int, origin: int, size: int
) -> int:
    step = math.floor(per_stop * math.log2(value / base) + 0.5)
    return min(size - 1, max(0, origin + step))


def _iso_bucket(value: float) -> int:
    return _stop_index(value, 100, 3, ISO_ORIGIN, len(ISO_STOPS))


def _aperture_bucket(value: float) -> int:
    return _stop_index(value, 1, 6, APERTURE_ORIGIN, len(APERTURE_STOPS))


def _shutter_bucket(value: float) -> int:
    return _stop_index(value, 1, 1, SHUTTER_ORIGIN, len(SHUTTER_STOPS))


def _focal_bucket(value: float) -> int:
    return bisect_right(FOCAL_EDGES, value) - 1


def _focal_label(index: int) -> str:
    if index == len(FOCAL_EDGES) - 1:
        return f"{FOCAL_EDGES[index]}+ mm"
    return f"{FOCAL_EDGES[index]}–{FOCAL_EDGES[index + 1]} mm"


def range_buckets(
    rows: Iterable[tuple[float, int]],
    bucket_of: Callable[[float], int],
    label_of: Callable[[int], str],
) -> list[RangeBucket]:
    buckets: dict[int, RangeBucket] = {}
    for value, count in rows:
        index = bucket_of(value)
        bucket = buckets.get(index)
        if bucket is None:
            buckets[index] = RangeBucket(
                label=label_of(index), min=value, max=value, count=count
            )
            continue
        bucket["min"] = min(bucket["min"], value)
        bucket["max"] = max(bucket["max"], value)
        bucket["count"] += count
    return [buckets[index] for index in sorted(buckets)]


def _value_counts(photos: QuerySet[Photo], column: str) -> list[tuple[float, int]]:
    return list(
        photos.filter(**{f"{column}__gt": 0})
        .values_list(column)
        .annotate(count=Count("pk"))
        .order_by(column)
    )


def get_camera_stats(user: User) -> CameraStats:
    photos = Photo.visible.owned_by(user)

    def buckets(
        column: str,
        bucket_of: Callable[[float], int],
        label_of: Callable[[int], str],
    ) -> list[RangeBucket]:
        return range_buckets(_value_counts(photos, column), bucket_of, label_of)

    return CameraStats(
        cameras=_camera_stats(photos),
        lenses=_lens_stats(photos),
        iso=buckets("metadata__iso", _iso_bucket, lambda index: str(ISO_STOPS[index])),
        aperture=buckets(
            "metadata__aperture",
            _aperture_bucket,
            lambda index: f"f/{APERTURE_STOPS[index]}",
        ),
        focal_length=buckets("metadata__focal_length", _focal_bucket, _focal_label),
        focal_length_35mm=buckets(
            "metadata__focal_length_35mm", _focal_bucket, _focal_label
        ),
        shutter_speed=buckets(
            "metadata__shutter_speed_seconds",
            _shutter_bucket,
            lambda index: SHUTTER_STOPS[index],
        ),
    )
