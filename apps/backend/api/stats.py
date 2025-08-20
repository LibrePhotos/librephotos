import os
from datetime import datetime

import numpy as np
from django.db import connection
from django.db.models import Avg, Count, Max, Min, Q, Sum
from django.db.models.functions import TruncMonth

import random
import re

import seaborn as sns
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
        return values[int(round(count / 2))]
    else:
        return sum(values[count / 2 - 1 : count / 2 + 1]) / Decimal(2.0)


def calc_megabytes(bytes):
    if bytes == 0 or bytes is None:
        return 0
    return round((bytes / 1024) / 1024)


def get_server_stats():
    # CPU architecture, Speed, Number of Cores, 64bit / 32 Bits
    import cpuinfo

    cpu_info = cpuinfo.get_cpu_info()
    # Available RAM
    import psutil

    available_ram = calc_megabytes(psutil.virtual_memory().total)
    # GPU
    import torch

    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = calc_megabytes(torch.cuda.get_device_properties(0).total_memory)
    else:
        gpu_name = ""
        gpu_memory = ""
    # Total Capacity
    import shutil

    total_storage, used_storage, free_storage = shutil.disk_usage("/")
    image_tag = os.environ.get("IMAGE_TAG", "")
    number_of_users = User.objects.filter(~Q(id=get_deleted_user().id)).count()
    users = []
    for user in User.objects.filter(~Q(id=get_deleted_user().id)):
        date_joined = user.date_joined
        number_of_photos = Photo.objects.filter(Q(owner=user)).count()
        number_of_videos = Photo.objects.filter(Q(owner=user) & Q(video=True)).count()
        number_of_captions = Photo.objects.filter(
            Q(owner=user)
            & Q(caption_instance__captions_json__user_caption__isnull=False)
        ).count()
        number_of_generated_captions = Photo.objects.filter(
            Q(owner=user) & Q(caption_instance__captions_json__im2txt__isnull=False)
        ).count()
        number_of_albums = AlbumUser.objects.filter(Q(owner=user)).count()
        min_number_of_photos_per_album = (
            AlbumUser.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Min("count"))
        )
        max_number_of_photos_per_album = (
            AlbumUser.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Max("count"))
        )
        mean_number_of_photos_per_album = (
            AlbumUser.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Avg("count"))
        )
        median_number_of_photos_per_album = median_value(
            AlbumUser.objects.filter(Q(owner=user)).annotate(count=Count("photos")),
            "count",
        )
        min_number_of_videos_per_album = (
            AlbumUser.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Min("count"))
        )
        max_number_of_videos_per_album = (
            AlbumUser.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Max("count"))
        )
        mean_number_of_videos_per_album = (
            AlbumUser.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Avg("count"))
        )
        median_number_of_videos_per_album = median_value(
            AlbumUser.objects.filter(Q(owner=user)).annotate(
                count=Count("photos", filter=Q(photos__video=True))
            ),
            "count",
        )
        number_of_persons = Person.objects.filter(Q(cluster_owner=user)).count()
        min_number_of_faces_per_person = (
            Person.objects.filter(Q(cluster_owner=user))
            .annotate(count=Count("faces"))
            .aggregate(Min("count"))
        )
        max_number_of_faces_per_person = (
            Person.objects.filter(Q(cluster_owner=user))
            .annotate(count=Count("faces"))
            .aggregate(Max("count"))
        )
        mean_number_of_faces_per_person = (
            Person.objects.filter(Q(cluster_owner=user))
            .annotate(count=Count("faces"))
            .aggregate(Avg("count"))
        )
        median_number_of_faces_per_person = median_value(
            Person.objects.filter(Q(cluster_owner=user)).annotate(count=Count("faces")),
            "count",
        )
        number_of_clusters = Cluster.objects.filter(Q(owner=user)).count()
        number_of_places = AlbumPlace.objects.filter(Q(owner=user)).count()
        min_number_of_photos_per_place = (
            AlbumPlace.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Min("count"))
        )
        max_number_of_photos_per_place = (
            AlbumPlace.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Max("count"))
        )
        mean_number_of_photos_per_place = (
            AlbumPlace.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Avg("count"))
        )
        median_number_of_photos_per_place = median_value(
            AlbumPlace.objects.filter(Q(owner=user)).annotate(count=Count("photos")),
            "count",
        )
        min_number_of_videos_per_place = (
            AlbumPlace.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Min("count"))
        )
        max_number_of_videos_per_place = (
            AlbumPlace.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Max("count"))
        )
        mean_number_of_videos_per_place = (
            AlbumPlace.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Avg("count"))
        )
        median_number_of_videos_per_place = median_value(
            AlbumPlace.objects.filter(Q(owner=user)).annotate(
                count=Count("photos", filter=Q(photos__video=True))
            ),
            "count",
        )
        number_of_things = AlbumThing.objects.filter(Q(owner=user)).count()
        min_number_of_photos_per_thing = (
            AlbumThing.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Min("count"))
        )
        max_number_of_photos_per_thing = (
            AlbumThing.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Max("count"))
        )
        mean_number_of_photos_per_thing = (
            AlbumThing.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Avg("count"))
        )
        median_number_of_photos_per_thing = median_value(
            AlbumThing.objects.filter(Q(owner=user)).annotate(count=Count("photos")),
            "count",
        )
        min_number_of_videos_per_thing = (
            AlbumThing.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Min("count"))
        )
        max_number_of_videos_per_thing = (
            AlbumThing.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Max("count"))
        )
        mean_number_of_videos_per_thing = (
            AlbumThing.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Avg("count"))
        )
        median_number_of_videos_per_thing = median_value(
            AlbumThing.objects.filter(Q(owner=user)).annotate(
                count=Count("photos", filter=Q(photos__video=True))
            ),
            "count",
        )
        number_of_events = AlbumAuto.objects.filter(Q(owner=user)).count()
        min_number_of_photos_per_event = (
            AlbumAuto.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Min("count"))
        )
        max_number_of_photos_per_event = (
            AlbumAuto.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Max("count"))
        )
        mean_number_of_photos_per_event = (
            AlbumAuto.objects.filter(Q(owner=user))
            .annotate(count=Count("photos"))
            .aggregate(Avg("count"))
        )
        median_number_of_photos_per_event = median_value(
            AlbumAuto.objects.filter(Q(owner=user)).annotate(count=Count("photos")),
            "count",
        )
        min_number_of_videos_per_event = (
            AlbumAuto.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Min("count"))
        )
        max_number_of_videos_per_event = (
            AlbumAuto.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Max("count"))
        )
        mean_number_of_videos_per_event = (
            AlbumAuto.objects.filter(Q(owner=user))
            .annotate(count=Count("photos", filter=Q(photos__video=True)))
            .aggregate(Avg("count"))
        )
        median_number_of_videos_per_event = median_value(
            AlbumAuto.objects.filter(Q(owner=user)).annotate(
                count=Count("photos", filter=Q(photos__video=True))
            ),
            "count",
        )
        number_of_favorites = Photo.objects.filter(
            Q(owner=user) & Q(rating__gte=user.favorite_min_rating)
        ).count()
        number_of_hidden = Photo.objects.filter(Q(owner=user) & Q(hidden=True)).count()
        number_of_public = Photo.objects.filter(Q(owner=user) & Q(public=True)).count()
        users.append(
            {
                "date_joined": date_joined.strftime("%d-%m-%Y"),
                "total_file_size_in_mb": calc_megabytes(
                    Photo.objects.filter(Q(owner=user)).aggregate(Sum("size"))[
                        "size__sum"
                    ]
                    or None
                ),
                "number_of_photos": number_of_photos,
                "number_of_videos": number_of_videos,
                "number_of_captions": number_of_captions,
                "number_of_generated_captions": number_of_generated_captions,
                "album": {
                    "count": number_of_albums,
                    "min": min_number_of_photos_per_album["count__min"] or None,
                    "max": max_number_of_photos_per_album["count__max"] or None,
                    "mean": mean_number_of_photos_per_album["count__avg"] or None,
                    "median": median_number_of_photos_per_album,
                    "min_videos": min_number_of_videos_per_album["count__min"] or None,
                    "max_videos": max_number_of_videos_per_album["count__max"] or None,
                    "mean_videos": mean_number_of_videos_per_album["count__avg"]
                    or None,
                    "median_videos": median_number_of_videos_per_album,
                },
                "person": {
                    "count": number_of_persons,
                    "min": min_number_of_faces_per_person["count__min"] or None,
                    "max": max_number_of_faces_per_person["count__max"] or None,
                    "mean": mean_number_of_faces_per_person["count__avg"] or None,
                    "median": median_number_of_faces_per_person,
                },
                "number_of_clusters": number_of_clusters,
                "places": {
                    "count": number_of_places,
                    "min": min_number_of_photos_per_place["count__min"] or None,
                    "max": max_number_of_photos_per_place["count__max"] or None,
                    "mean": mean_number_of_photos_per_place["count__avg"] or None,
                    "median": median_number_of_photos_per_place,
                    "min_videos": min_number_of_videos_per_place["count__min"] or None,
                    "max_videos": max_number_of_videos_per_place["count__max"] or None,
                    "mean_videos": mean_number_of_videos_per_place["count__avg"]
                    or None,
                    "median_videos": median_number_of_videos_per_place,
                },
                "things": {
                    "count": number_of_things,
                    "min": min_number_of_photos_per_thing["count__min"] or None,
                    "max": max_number_of_photos_per_thing["count__max"] or None,
                    "mean": mean_number_of_photos_per_thing["count__avg"] or None,
                    "median": median_number_of_photos_per_thing,
                    "min_videos": min_number_of_videos_per_thing["count__min"] or None,
                    "max_videos": max_number_of_videos_per_thing["count__max"] or None,
                    "mean_videos": mean_number_of_videos_per_thing["count__avg"]
                    or None,
                    "median_videos": median_number_of_videos_per_thing,
                },
                "events": {
                    "count": number_of_events,
                    "min": min_number_of_photos_per_event["count__min"] or None,
                    "max": max_number_of_photos_per_event["count__max"] or None,
                    "mean": mean_number_of_photos_per_event["count__avg"] or None,
                    "median": median_number_of_photos_per_event,
                    "min_videos": min_number_of_videos_per_event["count__min"] or None,
                    "max_videos": max_number_of_videos_per_event["count__max"] or None,
                    "mean_videos": mean_number_of_videos_per_event["count__avg"]
                    or None,
                    "median_videos": median_number_of_videos_per_event,
                },
                "number_of_favorites": number_of_favorites,
                "number_of_hidden": number_of_hidden,
                "number_of_public": number_of_public,
            }
        )
    res = {
        "cpu_info": cpu_info,
        "image_tag": image_tag,
        "available_ram_in_mb": available_ram,
        "gpu_name": gpu_name,
        "gpu_memory_in_mb": gpu_memory,
        "total_storage_in_mb": calc_megabytes(total_storage),
        "used_storage_in_mb": calc_megabytes(used_storage),
        "free_storage_in_mb": calc_megabytes(free_storage),
        "number_of_users": number_of_users,
        "users": users,
    }
    return res


def get_count_stats(user):
    num_photos = Photo.visible.filter(Q(owner=user)).distinct().count()
    num_missing_photos = Photo.objects.filter(
        Q(owner=user) & Q(files=None) | Q(main_file=None)
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


def get_searchterms_wordcloud(user):
    # Python fallbacks (SQLite): stream and aggregate
    from collections import Counter

    out = {"captions": [], "people": [], "locations": []}

    # Captions: use Places365 categories from captions_json
    captions_counter: Counter[str] = Counter()
    captions_iter = (
        Photo.objects.filter(owner=user)
        .exclude(caption_instance__captions_json__isnull=True)
        .values_list("caption_instance__captions_json", flat=True)
        .iterator(chunk_size=2000)
    )
    for caps in captions_iter:
        try:
            categories = (caps or {}).get("places365", {}).get("categories", [])
            if isinstance(categories, list):
                for cat in categories:
                    if not cat:
                        continue
                    captions_counter[str(cat)] += 1
        except Exception:
            continue

    # People: aggregate with ORM to avoid per-row Python loops
    people_rows = (
        Face.objects.filter(photo__owner=user, person__name__isnull=False)
        .values("person__name")
        .annotate(c=Count("id"))
        .order_by("-c")[:100]
    )

    # Locations: parse geolocation_json, ignore postcode and poi, one word per photo
    locations_counter: Counter[str] = Counter()
    geo_iter = (
        Photo.objects.filter(owner=user)
        .exclude(geolocation_json=None)
        .values_list("image_hash", "geolocation_json")
        .iterator(chunk_size=2000)
    )
    for _image_hash, geo in geo_iter:
        try:
            features = (geo or {}).get("features", [])
        except Exception:
            features = []
        seen_values = set()
        for feature in features:
            if not isinstance(feature, dict):
                continue
            place_type = feature.get("place_type")
            value = feature.get("text")
            if not value:
                continue
            # place_type can be list or string
            types = place_type if isinstance(place_type, list) else [place_type]
            types = [t for t in types if t]
            if any(t in ("postcode", "poi") for t in types):
                continue
            seen_values.add(str(value))
        for value in seen_values:
            locations_counter[value] += 1

    # Build outputs (log of count as before)
    for label, count in captions_counter.most_common(100):
        out["captions"].append({"label": label, "y": float(np.log(count))})
    for row in people_rows:
        out["people"].append(
            {"label": row["person__name"], "y": float(np.log(row["c"]))}
        )
    for label, count in locations_counter.most_common(100):
        out["locations"].append({"label": label, "y": float(np.log(count))})

    return out


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
    palette = sns.color_palette("hls", 10).as_hex()

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
    numeric_pattern = re.compile(r"^(-)?[0-9]+$")
    for geo in photo_geo_iter:
        try:
            features = (geo or {}).get("features", [])
        except Exception:
            features = []
        for feature in features:
            location_text = feature.get("text") if isinstance(feature, dict) else None
            if not location_text or numeric_pattern.match(str(location_text)):
                continue
            center = feature.get("center") if isinstance(feature, dict) else None
            if not (isinstance(center, (list, tuple)) and len(center) >= 2):
                continue
            # Keep first occurrence per distinct location name
            if location_text not in results_by_location:
                lon = center[0]
                lat = center[1]
                try:
                    lat_f = float(lat)
                    lon_f = float(lon)
                except Exception:
                    continue
                results_by_location[location_text] = [lat_f, lon_f, location_text]

    # Order by location to mimic SQL ordering
    res = [results_by_location[key] for key in sorted(results_by_location.keys())]
    elapsed = (datetime.now() - start).total_seconds()
    logger.info("location clustering computed in %.2f seconds" % elapsed)
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

    colors = sns.color_palette("Paired", len(city_start_end_duration)).as_hex()

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
