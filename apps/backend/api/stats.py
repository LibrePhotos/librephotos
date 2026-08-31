import os
from collections import Counter
from datetime import datetime

import numpy as np
from django.db import connection
from django.db.models import Avg, Count, Max, Min, Q, Sum
from django.db.models.functions import TruncMonth

import random
import re

from api.color_palettes import hex_palette
from api.util import logger

from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Cluster,
    Face,
    Person,
    Photo,
    User,
)
from api.models.user import get_deleted_user


def _is_sqlite() -> bool:
    return connection.vendor == "sqlite"


def jump_by_month(start_date, end_date, month_step=1):
    current_date = start_date
    yield current_date
    while current_date < end_date:
        carry, new_month = divmod(current_date.month - 1 + month_step, 12)
        new_month += 1
        current_date = current_date.replace(
            year=current_date.year + carry, month=new_month
        )
        yield current_date


def median_value(queryset, term):
    from decimal import Decimal

    count = queryset.count()
    if count == 0:
        return
    values = queryset.values_list(term, flat=True).order_by(term)
    if count % 2 == 1:
        return values[count // 2]
    else:
        return sum(values[count // 2 - 1 : count // 2 + 1]) / Decimal(2.0)


def calc_megabytes(bytes):
    if bytes == 0 or bytes is None:
        return 0
    return round((bytes / 1024) / 1024)


def _coerce_cache_size(value):
    """Normalize a py-cpuinfo cache-size field to an int (bytes), or None.

    py-cpuinfo returns these as ints on most CPUs, but ``_friendly_bytes_to_int``
    falls back to the raw string (e.g. "1.3 MiB", "32 KiB") when the value can't be
    parsed as a plain int -- seen on hardware like the Xeon Gold 6148 via newer
    lscpu. The frontend stats schema requires a number, so coerce here to keep the
    API contract numeric. See issue #1864.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        import re

        match = re.match(
            r"^\s*([0-9]*\.?[0-9]+)\s*([KMGT]?i?B)?\s*$", value, re.IGNORECASE
        )
        if not match:
            return None
        number = float(match.group(1))
        unit = (match.group(2) or "B").upper()
        multipliers = {
            "B": 1,
            "KB": 1000,
            "KIB": 1024,
            "MB": 1000**2,
            "MIB": 1024**2,
            "GB": 1000**3,
            "GIB": 1024**3,
            "TB": 1000**4,
            "TIB": 1024**4,
        }
        return int(round(number * multipliers.get(unit, 1)))
    return None


def _get_cpu_info():
    # CPU architecture, Speed, Number of Cores, 64bit / 32 Bits
    import cpuinfo

    cpu_info = cpuinfo.get_cpu_info()
    # py-cpuinfo may report cache sizes as non-numeric strings on some CPUs; keep
    # the API numeric so the frontend's number schema doesn't reject them (#1864).
    for cache_field in (
        "l1_data_cache_size",
        "l1_instruction_cache_size",
        "l2_cache_size",
        "l3_cache_size",
    ):
        if cache_field in cpu_info:
            coerced = _coerce_cache_size(cpu_info[cache_field])
            if coerced is None:
                del cpu_info[cache_field]
            else:
                cpu_info[cache_field] = coerced
    return cpu_info


def _get_gpu_info():
    import torch

    if not torch.cuda.is_available():
        return "", ""
    return (
        torch.cuda.get_device_name(0),
        calc_megabytes(torch.cuda.get_device_properties(0).total_memory),
    )


def _aggregate_stats(queryset, related, photo_filter=None):
    annotated = queryset.annotate(count=Count(related, filter=photo_filter))
    return {
        "min": annotated.aggregate(Min("count"))["count__min"] or None,
        "max": annotated.aggregate(Max("count"))["count__max"] or None,
        "mean": annotated.aggregate(Avg("count"))["count__avg"] or None,
        "median": median_value(annotated, "count"),
    }


def _photo_group_stats(queryset):
    stats = {"count": queryset.count()}
    stats.update(_aggregate_stats(queryset, "photos"))
    videos = _aggregate_stats(queryset, "photos", Q(photos__video=True))
    stats.update({f"{key}_videos": value for key, value in videos.items()})
    return stats


def _person_group_stats(queryset):
    stats = {"count": queryset.count()}
    stats.update(_aggregate_stats(queryset, "faces"))
    return stats


def _get_user_stats(user):
    owned = Q(owner=user)
    photos = Photo.objects.filter(owned)
    return {
        "date_joined": user.date_joined.strftime("%d-%m-%Y"),
        "total_file_size_in_mb": calc_megabytes(
            photos.aggregate(Sum("size"))["size__sum"] or None
        ),
        "number_of_photos": photos.count(),
        "number_of_videos": Photo.objects.filter(owned & Q(video=True)).count(),
        "number_of_screenshots": Photo.objects.filter(
            owned & Q(is_screenshot=True)
        ).count(),
        "number_of_documents": Photo.objects.filter(
            owned & Q(is_document=True)
        ).count(),
        "number_of_captions": Photo.objects.filter(
            owned & Q(caption_instance__captions_json__user_caption__isnull=False)
        ).count(),
        "number_of_generated_captions": Photo.objects.filter(
            owned & Q(caption_instance__captions_json__im2txt__isnull=False)
        ).count(),
        "album": _photo_group_stats(AlbumUser.objects.filter(owned)),
        "person": _person_group_stats(Person.objects.filter(Q(cluster_owner=user))),
        "number_of_clusters": Cluster.objects.filter(owned).count(),
        "places": _photo_group_stats(AlbumPlace.objects.filter(owned)),
        "things": _photo_group_stats(AlbumThing.objects.filter(owned)),
        "events": _photo_group_stats(AlbumAuto.objects.filter(owned)),
        "number_of_favorites": Photo.objects.filter(
            owned & Q(rating__gte=user.favorite_min_rating)
        ).count(),
        "number_of_hidden": Photo.objects.filter(owned & Q(hidden=True)).count(),
        "number_of_public": Photo.objects.filter(owned & Q(public=True)).count(),
    }


def get_server_stats():
    import psutil
    import shutil

    cpu_info = _get_cpu_info()
    available_ram = calc_megabytes(psutil.virtual_memory().total)
    gpu_name, gpu_memory = _get_gpu_info()
    total_storage, used_storage, free_storage = shutil.disk_usage("/")
    real_users = User.objects.filter(~Q(id=get_deleted_user().id))
    return {
        "cpu_info": cpu_info,
        "image_tag": os.environ.get("IMAGE_TAG", ""),
        "available_ram_in_mb": available_ram,
        "gpu_name": gpu_name,
        "gpu_memory_in_mb": gpu_memory,
        "total_storage_in_mb": calc_megabytes(total_storage),
        "used_storage_in_mb": calc_megabytes(used_storage),
        "free_storage_in_mb": calc_megabytes(free_storage),
        "number_of_users": real_users.count(),
        "users": [_get_user_stats(user) for user in real_users],
    }


def get_count_stats(user):
    num_photos = Photo.visible.filter(Q(owner=user)).distinct().count()
    num_screenshots = (
        Photo.visible.filter(Q(owner=user) & Q(is_screenshot=True)).distinct().count()
    )
    num_documents = (
        Photo.visible.filter(Q(owner=user) & Q(is_document=True)).distinct().count()
    )
    num_missing_photos = Photo.objects.filter(
        Q(owner=user) & (Q(files=None) | Q(main_file=None))
    ).count()
    num_faces = Face.objects.filter(photo__owner=user).count()
    num_unknown_faces = Face.objects.filter(
        (
            Q(person__name__exact="unknown")
            | Q(person__name__exact=Person.UNKNOWN_PERSON_NAME)
        )
        & Q(photo__owner=user)
    ).count()
    num_labeled_faces = Face.objects.filter(
        Q(person__isnull=False) & Q(photo__owner=user) & Q(photo__hidden=False)
    ).count()
    num_inferred_faces = Face.objects.filter(
        Q(person=True) & Q(photo__owner=user) & Q(photo__hidden=False)
    ).count()
    num_people = (
        Person.objects.filter(
            Q(faces__photo__hidden=False)
            & Q(faces__photo__owner=user)
            & Q(faces__person__isnull=False)
        )
        .distinct()
        .annotate(viewable_face_count=Count("faces"))
        .filter(Q(viewable_face_count__gt=0))
        .count()
    )
    num_albumauto = (
        AlbumAuto.objects.filter(owner=user)
        .annotate(photo_count=Count("photos"))
        .filter(Q(photo_count__gt=0))
        .count()
    )
    num_albumdate = (
        AlbumDate.objects.filter(owner=user)
        .annotate(photo_count=Count("photos"))
        .filter(Q(photo_count__gt=0))
        .count()
    )
    num_albumuser = (
        AlbumUser.objects.filter(owner=user)
        .annotate(photo_count=Count("photos"))
        .filter(Q(photo_count__gt=0))
        .count()
    )

    res = {
        "num_photos": num_photos,
        "num_screenshots": num_screenshots,
        "num_documents": num_documents,
        "num_missing_photos": num_missing_photos,
        "num_faces": num_faces,
        "num_people": num_people,
        "num_unknown_faces": num_unknown_faces,
        "num_labeled_faces": num_labeled_faces,
        "num_inferred_faces": num_inferred_faces,
        "num_albumauto": num_albumauto,
        "num_albumdate": num_albumdate,
        "num_albumuser": num_albumuser,
    }
    return res


def get_photo_month_counts(user):
    counts = (
        Photo.objects.filter(owner=user)
        .exclude(exif_timestamp=None)
        .annotate(month=TruncMonth("exif_timestamp"))
        .values("month")
        .annotate(c=Count("image_hash"))
        .values("month", "c")
    )

    all_months = [
        c["month"]
        for c in counts
        if c["month"].year >= 2000 and c["month"].year <= datetime.now().year
    ]

    if len(all_months) > 0:
        first_month = min(all_months)
        last_month = max(all_months)

        month_span = jump_by_month(first_month, last_month)
        counts = sorted(counts, key=lambda k: k["month"])

        res = []
        for count in counts:
            key = "-".join([str(count["month"].year), str(count["month"].month)])
            count = count["c"]
            res.append([key, count])
        res = dict(res)

        out = []
        for month in month_span:
            m = "-".join([str(month.year), str(month.month)])
            if m in res.keys():
                out.append({"month": m, "count": res[m]})
            else:
                out.append({"month": m, "count": 0})

        return out
    else:
        return []


class _LabelTally:
    """Counts labels and remembers the order in which they were first seen."""

    def __init__(self):
        self.counts: Counter[str] = Counter()
        self.first_seen: dict[str, int] = {}

    def add(self, label, order_index, first_seen=None):
        self.counts[label] += 1
        if label in self.first_seen:
            return order_index
        self.first_seen[label] = order_index if first_seen is None else first_seen
        return order_index + 1

    def top(self, limit=100):
        return sorted(
            self.counts.items(),
            key=lambda kv: (-kv[1], self.first_seen.get(kv[0], 1_000_000)),
        )[:limit]


def _places365_labels(captions_json):
    places365 = (captions_json or {}).get("places365", {})
    labels = []
    for key in ("categories", "attributes"):
        values = places365.get(key, [])
        if isinstance(values, list):
            labels.extend(str(value) for value in values if value)
    environment = places365.get("environment")
    if isinstance(environment, str) and environment:
        labels.append(environment)
    return labels


def _location_texts(geolocation_json):
    try:
        features = (geolocation_json or {}).get("features", [])
    except Exception:
        features = []
    texts = set()
    for feature in features:
        if not isinstance(feature, dict):
            continue
        value = feature.get("text")
        if not value:
            continue
        place_type = feature.get("place_type")
        types = place_type if isinstance(place_type, list) else [place_type]
        if any(t in ("postcode", "poi") for t in types if t):
            continue
        texts.add(str(value))
    return texts


def _wordcloud_entries(pairs):
    return [{"label": label, "y": float(np.log(count))} for label, count in pairs]


def get_searchterms_wordcloud(user):
    # Python fallbacks (SQLite): stream and aggregate
    order_index = 0

    # Captions: use Places365 categories, attributes and environment from captions_json
    captions = _LabelTally()
    captions_iter = (
        Photo.objects.filter(owner=user)
        .exclude(caption_instance__captions_json__isnull=True)
        .values_list("caption_instance__captions_json", flat=True)
        .iterator(chunk_size=2000)
    )
    for caps in captions_iter:
        try:
            labels = _places365_labels(caps)
        except Exception:
            continue
        for label in labels:
            order_index = captions.add(label, order_index)

    # Locations: parse geolocation_json, ignore postcode and poi, one word per photo
    locations = _LabelTally()
    geo_iter = (
        Photo.objects.filter(owner=user)
        .exclude(geolocation_json=None)
        .values_list("geolocation_json", flat=True)
        .iterator(chunk_size=2000)
    )
    for geo in geo_iter:
        for value in _location_texts(geo):
            order_index = locations.add(
                value, order_index, captions.first_seen.get(value)
            )

    # People: aggregate with ORM to avoid per-row Python loops
    people_rows = (
        Face.objects.filter(photo__owner=user, person__name__isnull=False)
        .values("person__name")
        .annotate(c=Count("id"))
        .order_by("-c")[:100]
    )

    return {
        "captions": _wordcloud_entries(captions.top()),
        "people": [
            {"label": row["person__name"], "y": float(np.log(row["c"]))}
            for row in people_rows
        ],
        "locations": _wordcloud_entries(locations.top()),
    }


def get_location_sunburst(user):
    levels = []

    from collections import Counter

    counter = Counter()
    # Stream results to avoid caching entire queryset in memory
    photo_geo_iter = (
        Photo.objects.filter(owner=user)
        .exclude(geolocation_json=None)
        .values_list("geolocation_json", flat=True)
        .iterator(chunk_size=2000)
    )
    for geo in photo_geo_iter:
        try:
            features = (geo or {}).get("features", [])
        except Exception:
            features = []
        if not isinstance(features, list) or len(features) < 3:
            continue
        f1 = features[-1] if isinstance(features[-1], dict) else {}
        f2 = features[-2] if isinstance(features[-2], dict) else {}
        f3 = features[-3] if isinstance(features[-3], dict) else {}
        l1 = f1.get("text")
        l2 = f2.get("text")
        l3 = f3.get("text")
        if l1 is None or l2 is None or l3 is None:
            continue
        counter[(l1, l2, l3)] += 1
    levels = [[k[0], k[1], k[2], v] for k, v in counter.items()]
    levels = sorted(levels, key=lambda x: (x[0], x[1], x[2]))

    data_structure = {"name": "Places I've visited", "children": []}
    palette = hex_palette("hls", 10)

    for data in levels:
        depth_cursor = data_structure["children"]
        for i, item in enumerate(data[0:-2]):
            idx = None
            j = None
            for j, c in enumerate(depth_cursor):
                if item in c.values():
                    idx = j
            if idx is None:
                depth_cursor.append(
                    {"name": item, "children": [], "hex": random.choice(palette)}
                )
                idx = len(depth_cursor) - 1

            depth_cursor = depth_cursor[idx]["children"]
            if i == len(data) - 3:
                depth_cursor.append(
                    {
                        "name": data[-2],
                        "value": data[-1],
                        "hex": random.choice(palette),
                    }
                )

    return data_structure


_NUMERIC_LOCATION_NAME = re.compile(r"^(-)?[0-9]+$")


def _location_cluster_row(feature):
    if not isinstance(feature, dict):
        return None
    location_text = feature.get("text")
    if not location_text or _NUMERIC_LOCATION_NAME.match(str(location_text)):
        return None
    center = feature.get("center")
    if not (isinstance(center, (list, tuple)) and len(center) >= 2):
        return None
    try:
        return [float(center[1]), float(center[0]), location_text]
    except Exception:
        return None


def get_location_clusters(user):
    start = datetime.now()
    # Build clusters in Python from JSON fields (works for both SQLite and Postgres)
    results_by_location = {}
    # Stream results to avoid large memory usage
    photo_geo_iter = (
        Photo.objects.filter(owner=user)
        .exclude(geolocation_json=None)
        .values_list("geolocation_json", flat=True)
        .iterator(chunk_size=2000)
    )
    for geo in photo_geo_iter:
        try:
            features = (geo or {}).get("features", [])
        except Exception:
            features = []
        for feature in features:
            row = _location_cluster_row(feature)
            if row is not None:
                # Keep first occurrence per distinct location name
                results_by_location.setdefault(row[2], row)

    # Order by location to mimic SQL ordering
    res = [results_by_location[key] for key in sorted(results_by_location.keys())]
    elapsed = (datetime.now() - start).total_seconds()
    logger.info("location clustering computed in %.2f seconds", elapsed)
    return res


def get_location_timeline(user):
    # Python fallback: iterate photos ordered by timestamp and build contiguous location spans
    def extract_location(geo: dict) -> str | None:
        if not geo or not isinstance(geo, dict):
            return None
        features = geo.get("features", [])
        if not isinstance(features, list) or not features:
            return None
        last = features[-1]
        if isinstance(last, dict):
            return last.get("text")
        return None

    # Stream through photos ordered by exif_timestamp
    qs = (
        Photo.objects.filter(owner=user)
        .exclude(exif_timestamp=None)
        .order_by("exif_timestamp")
        .values_list("geolocation_json", "exif_timestamp")
        .iterator(chunk_size=2000)
    )
    spans: list[tuple[str, datetime, datetime]] = []
    current_loc: str | None = None
    run_start: datetime | None = None
    last_time: datetime | None = None
    for geo, ts in qs:
        loc = extract_location(geo)
        if loc is None:
            continue
        if current_loc is None:
            current_loc = loc
            run_start = ts
            last_time = ts
            continue
        if loc == current_loc:
            last_time = ts
            continue
        # location changed → close previous span
        spans.append((current_loc, run_start, last_time))
        current_loc = loc
        run_start = ts
        last_time = ts
    # close final span
    if current_loc is not None and run_start is not None and last_time is not None:
        spans.append((current_loc, run_start, last_time))

    # Coalesce: set each span's end to next span's begin (like SQL LEAD(begin))
    city_start_end_duration = []
    for idx, (loc, begin, end) in enumerate(spans):
        new_end = spans[idx + 1][1] if idx + 1 < len(spans) else end
        duration_sec = (new_end - begin).total_seconds()
        city_start_end_duration.append((loc, begin, new_end, duration_sec))

    colors = hex_palette("Paired", len(city_start_end_duration))

    data = []
    for idx, sted in enumerate(city_start_end_duration):
        data.append(
            {
                "data": [sted[3]],
                "color": colors[idx],
                "loc": sted[0],
                "start": sted[1].timestamp(),
                "end": sted[2].timestamp(),
            }
        )
    return data
