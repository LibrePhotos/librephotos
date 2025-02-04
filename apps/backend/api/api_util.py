import os
import random
import stat
from datetime import datetime

import numpy as np
import seaborn as sns
from django.db import connection
from django.db.models import Avg, Count, Max, Min, Q, Sum
from django.db.models.functions import TruncMonth

from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Cluster,
    Face,
    LongRunningJob,
    Person,
    Photo,
    User,
)
from api.models.user import get_deleted_user
from api.serializers.job import LongRunningJobSerializer
from api.util import logger


def get_current_job():
    job_detail = None
    running_job = (
        LongRunningJob.objects.filter(finished=False).order_by("-started_at").first()
    )
    if running_job:
        job_detail = LongRunningJobSerializer(running_job).data
    return job_detail


def shuffle(list):
    random.shuffle(list)
    return list


def is_hidden(filepath):
    name = os.path.basename(os.path.abspath(filepath))
    return name.startswith(".") or has_hidden_attribute(filepath)


def has_hidden_attribute(filepath):
    try:
        return bool(os.stat(filepath).st_file_attributes & stat.FILE_ATTRIBUTE_HIDDEN)
    except Exception:
        return False


def path_to_dict(path, recurse=2):
    d = {"title": os.path.basename(path), "absolute_path": path}
    if recurse > 0:
        d["children"] = [
            path_to_dict(os.path.join(path, x), recurse - 1)
            for x in os.scandir(path)
            if os.path.isdir(os.path.join(path, x))
            and not is_hidden(os.path.join(path, x))
        ]
    else:
        d["children"] = []
    # sort children by title alphabetically (case insensitive)
    d["children"] = sorted(d["children"], key=lambda k: k["title"].lower())
    return d


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


def get_location_timeline(user):
    with connection.cursor() as cursor:
        raw_sql = """
            WITH data AS (
                SELECT
                    jsonb_extract_path_text("features", '-1', 'text') "location"
                    , "api_photo"."exif_timestamp"
                    , ROW_NUMBER() OVER(ORDER BY "api_photo"."exif_timestamp") "unique_order"
                FROM
                    "api_photo"
                    , jsonb_extract_path("api_photo"."geolocation_json", 'features') "features"
                WHERE
                    (
                        "api_photo"."exif_timestamp" IS NOT NULL
                        AND jsonb_extract_path("features", '-1', 'text') IS NOT NULL
                        AND "api_photo"."owner_id" = %s
                    )
                ORDER BY
                     "api_photo"."exif_timestamp"
            ),
            partitioned AS (
                SELECT
                    "data"."exif_timestamp"
                    , "data"."location"
                    , "data"."unique_order"
                    , "data"."unique_order" - ROW_NUMBER() OVER (PARTITION BY "data"."location" ORDER BY "data"."unique_order") "grp"
                FROM
                    "data"
            ),
            grouped AS (
                SELECT
                    "partitioned"."location"
                    , MIN("partitioned"."exif_timestamp") "begin"
                    , MAX("partitioned"."exif_timestamp") "end"
                FROM
                    "partitioned"
                GROUP BY
                    "partitioned"."location"
                    , "partitioned"."grp"
                ORDER BY
                    MIN("partitioned"."exif_timestamp")
            ),
            coalesced AS (
                SELECT
                    "grouped"."location"
                    , "grouped"."begin"
                    , COALESCE(
                        LEAD("grouped"."begin", 1) OVER (
                            ORDER BY "grouped"."begin"
                    ), "grouped"."end") "end"
                FROM
                    "grouped"
                ORDER BY
                    "grouped"."begin"
            )

            SELECT
                "coalesced"."location"
                , "coalesced"."begin"
                , "coalesced"."end"
                , EXTRACT(EPOCH FROM "coalesced"."end" - "coalesced"."begin")
            FROM
                "coalesced";
        """
        cursor.execute(raw_sql, [user.id])
        city_start_end_duration = [
            (row[0], row[1], row[2], row[3]) for row in cursor.fetchall()
        ]

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


def get_search_term_examples(user):
    default_search_terms = [
        "for people",
        "for places",
        "for things",
        "for time",
        "for file path or file name",
    ]

    possible_ids = list(
        Photo.objects.filter(owner=user)
        .exclude(captions_json={})[:1000]
        .values_list("image_hash", flat=True)
    )
    if len(possible_ids) > 99:
        possible_ids = random.choices(possible_ids, k=100)
    logger.info(f"{len(possible_ids)} possible ids")
    try:
        samples = (
            Photo.objects.filter(owner=user)
            .exclude(captions_json={})
            .filter(image_hash__in=possible_ids)
            .prefetch_related("faces")
            .prefetch_related("faces__person")
            .all()
        )
    except ValueError:
        return default_search_terms

    search_data = []
    search_terms = default_search_terms
    logger.info("Getting search terms for user %s", user.id)
    logger.info("Found %s photos", len(samples))
    for p in samples:
        faces = p.faces.all()
        terms_loc = ""
        if p.geolocation_json != {}:
            terms_loc = [
                f["text"]
                for f in p.geolocation_json["features"][-5:]
                if not f["text"].isdigit()
            ]
        terms_time = ""
        if p.exif_timestamp:
            terms_time = [str(p.exif_timestamp.year)]
        terms_people = []
        if p.faces.count() > 0:
            terms_people = [
                f.person.name.split(" ")[0] if f.person else "" for f in faces
            ]
        terms_things = ""
        if p.captions_json and p.captions_json["places365"] is not None:
            terms_things = p.captions_json["places365"]["categories"]

        terms = {
            "loc": terms_loc,
            "time": terms_time,
            "people": terms_people,
            "things": terms_things,
        }

        search_data.append(terms)
        search_terms = []
        for datum in search_data:
            term_time = ""
            term_thing = ""
            term_loc = ""
            term_people = ""
            if datum["loc"]:
                term_loc = random.choice(datum["loc"])
                search_terms.append(term_loc)
            if datum["time"]:
                term_time = random.choice(datum["time"])
                search_terms.append(term_time)
            if datum["things"]:
                term_thing = random.choice(datum["things"])
                search_terms.append(term_thing)
            if datum["people"]:
                term_people = random.choice(datum["people"])
                search_terms.append(term_people)

            search_term_loc_people = " ".join(shuffle([term_loc, term_people]))
            if random.random() > 0.3:
                search_terms.append(search_term_loc_people)

            search_term_time_people = " ".join(shuffle([term_time, term_people]))
            if random.random() > 0.3:
                search_terms.append(search_term_time_people)

            search_term_people_thing = " ".join(shuffle([term_people, term_thing]))
            if random.random() > 0.9:
                search_terms.append(search_term_people_thing)

            search_term_all = " ".join(
                shuffle([term_loc, term_people, term_time, term_thing])
            )
            if random.random() > 0.95:
                search_terms.append(search_term_all)

            search_term_loc_time = " ".join(shuffle([term_loc, term_time]))
            if random.random() > 0.3:
                search_terms.append(search_term_loc_time)

            search_term_loc_thing = " ".join(shuffle([term_loc, term_thing]))
            if random.random() > 0.9:
                search_terms.append(search_term_loc_thing)

            search_term_time_thing = " ".join(shuffle([term_time, term_thing]))
            if random.random() > 0.9:
                search_terms.append(search_term_time_thing)

    return list(filter(lambda x: len(x), set([x.strip() for x in search_terms])))


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
    # FLOPs (To-Do)
    # Available RAM
    import psutil

    available_ram = calc_megabytes(psutil.virtual_memory().total)
    # RAM Speed (To-Do: ????)
    # GPU
    import torch

    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = calc_megabytes(torch.cuda.get_device_properties(0).total_memory)
    else:
        gpu_name = ""
        gpu_memory = ""
    # Kind of storage system (local, nfs etc.) (To-Do)
    # Storage speed (hdd, ssd, nvme) (To-Do)
    # Total Capacity
    import shutil

    total_storage, used_storage, free_storage = shutil.disk_usage("/")
    # Docker image tag (latest, 2023w26 etc.) (To-Do: set this in build step)
    image_tag = os.environ.get("IMAGE_TAG", "")
    # Number of Users
    number_of_users = User.objects.filter(~Q(id=get_deleted_user().id)).count()
    users = []
    idx = 0
    for user in User.objects.filter(~Q(id=get_deleted_user().id)):
        # Days since joining
        date_joined = user.date_joined
        # Number of Photos
        number_of_photos = Photo.objects.filter(Q(owner=user)).count()
        # Number of Videos
        number_of_videos = Photo.objects.filter(Q(owner=user) & Q(video=True)).count()
        # Number of Files (To-Do: Owner missing)
        # number_of_files = File.objects.filter(Q(owner=user)).count()
        # Number of Captions
        number_of_captions = Photo.objects.filter(
            Q(owner=user) & Q(captions_json__user_caption__isnull=False)
        ).count()
        # Number of Generated Captions
        number_of_generated_captions = Photo.objects.filter(
            Q(owner=user) & Q(captions_json__im2txt__isnull=False)
        ).count()
        # Most common file type for photos (To-Do: Add mime type)
        # most_common_file_type = Photo.objects.filter(Q(owner=user)).values("file_extension").annotate(count=Count("file_extension")).order_by("-count").first()
        # Most common file type for videos (To-Do: Add mime type)
        # most_common_file_type_videos = Photo.objects.filter(Q(owner=user) & Q(video=True)).values("file_extension").annotate(count=Count("file_extension")).order_by("-count").first()
        # Number of Albums
        number_of_albums = AlbumUser.objects.filter(Q(owner=user)).count()
        # Min, Max, Mean, Median number of photos
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
        # Min, Max, Mean, Median number of videos
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
        # Number of Persons
        number_of_persons = Person.objects.filter(Q(cluster_owner=user)).count()
        # Min, Max, Mean, Median number of faces
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
        # Number of Clusters
        number_of_clusters = Cluster.objects.filter(Q(owner=user)).count()
        # Number of Places
        number_of_places = AlbumPlace.objects.filter(Q(owner=user)).count()
        # Min, Max, Mean, Median number of photos
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
        # Min, Max, Mean, Median number of videos
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
        # Number of Things
        number_of_things = AlbumThing.objects.filter(Q(owner=user)).count()
        # Min, Max, Mean, Median number of photos
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
        # Min, Max, Mean, Median number of videos
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
        # Number of Events
        number_of_events = AlbumAuto.objects.filter(Q(owner=user)).count()
        # Min, Max, Mean, Median number of photos
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
        # Min, Max, Mean, Median number of videos
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
        # Number of Favorites
        number_of_favorites = Photo.objects.filter(
            Q(owner=user) & Q(rating__gte=user.favorite_min_rating)
        ).count()
        # Number of Hidden
        number_of_hidden = Photo.objects.filter(Q(owner=user) & Q(hidden=True)).count()
        # Number of public
        number_of_public = Photo.objects.filter(Q(owner=user) & Q(public=True)).count()
        # Total File Size (To-Do: Should be files)
        total_file_size = (
            Photo.objects.filter(Q(owner=user)).aggregate(Sum("size"))["size__sum"]
            or None
        )
        user = {
            "date_joined": date_joined.strftime("%d-%m-%Y"),
            "total_file_size_in_mb": calc_megabytes(total_file_size),
            "number_of_photos": number_of_photos,
            "number_of_videos": number_of_videos,
            # "number_of_files": number_of_files,
            "number_of_captions": number_of_captions,
            "number_of_generated_captions": number_of_generated_captions,
            # "most_common_file_type": most_common_file_type,
            # "most_common_file_type_videos": most_common_file_type_videos,
            "album": {
                "count": number_of_albums,
                "min": min_number_of_photos_per_album["count__min"] or None,
                "max": max_number_of_photos_per_album["count__max"] or None,
                "mean": mean_number_of_photos_per_album["count__avg"] or None,
                "median": median_number_of_photos_per_album,
                "min_videos": min_number_of_videos_per_album["count__min"] or None,
                "max_videos": max_number_of_videos_per_album["count__max"] or None,
                "mean_videos": mean_number_of_videos_per_album["count__avg"] or None,
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
                "mean_videos": mean_number_of_videos_per_place["count__avg"] or None,
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
                "mean_videos": mean_number_of_videos_per_thing["count__avg"] or None,
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
                "mean_videos": mean_number_of_videos_per_event["count__avg"] or None,
                "median_videos": median_number_of_videos_per_event,
            },
            "number_of_favorites": number_of_favorites,
            "number_of_hidden": number_of_hidden,
            "number_of_public": number_of_public,
        }
        users.append(user)
        idx = idx + 1
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


def get_location_clusters(user):
    start = datetime.now()
    with connection.cursor() as cursor:
        raw_sql = """
            SELECT
                DISTINCT ON (jsonb_extract_path_text("feature", 'text')) jsonb_extract_path_text("feature", 'text') "location"
                , jsonb_extract_path_text("feature", 'center', '0')
                , jsonb_extract_path_text("feature", 'center', '1')
            FROM
                "api_photo"
                , jsonb_array_elements(jsonb_extract_path("api_photo"."geolocation_json", 'features')) "feature"
            WHERE (
                "api_photo"."owner_id" = %s
                AND NOT (jsonb_extract_path_text("feature", 'text') ~ '^(-)?[0-9]+$')
            )
            ORDER BY
                "location";
        """
        cursor.execute(raw_sql, [user.id])
        res = [[float(row[2]), float(row[1]), row[0]] for row in cursor.fetchall()]
        elapsed = (datetime.now() - start).total_seconds()
        logger.info("location clustering took %.2f seconds" % elapsed)
        return res


def get_location_sunburst(user):
    levels = []
    with connection.cursor() as cursor:
        raw_sql = """
            SELECT
                jsonb_extract_path_text("api_photo"."geolocation_json", 'features', '-1', 'text') "l1"
                , jsonb_extract_path_text("api_photo"."geolocation_json", 'features', '-2', 'text') "l2"
                , jsonb_extract_path_text("api_photo"."geolocation_json", 'features', '-3', 'text') "l3"
                , COUNT(*)
            FROM
                "api_photo"
            WHERE
                (
                    "api_photo"."owner_id" = %s
                    AND jsonb_array_length(jsonb_extract_path("api_photo"."geolocation_json", 'features')) >= 3
                )
            GROUP BY
                "l1"
                , "l2"
                , "l3"
            ORDER BY
                "l1"
                , "l2"
                , "l3"
        """
        cursor.execute(raw_sql, [user.id])
        levels = [[row[0], row[1], row[2], row[3]] for row in cursor.fetchall()]

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
    query = {}
    out = {"captions": [], "people": [], "locations": []}
    query["captions"] = """
        with captionList as (
            select unnest(regexp_split_to_array(search_captions,' , ')) caption
            from api_photo where owner_id = %(userid)s
        )
        select caption, count(*) from captionList group by caption order by count(*) desc limit 100;
    """
    query["people"] = """
        with NameList as (
            select api_person.name
            from api_photo join api_face on image_hash = api_face.photo_id
            join api_person on person_id = api_person.id
            where owner_id = %(userid)s
        )
        select name, count(*) from NameList group by name order by count(*) desc limit 100;
    """
    query["locations"] = """
         with arrayloctable as (
            select jsonb_array_elements(jsonb_extract_path(api_photo.geolocation_json,  'features')::jsonb) arrayloc , image_hash
            from api_photo where owner_id = %(userid)s
        ), loctable as (
            select jsonb_array_elements(jsonb_extract_path(arrayloc,'place_type'))::text as "key",
            replace(jsonb_extract_path(arrayloc,'text')::text,'"','') as "value", image_hash
            from arrayloctable
        ), OneWordPerPhoto as (  -- "key" values can be : "place","locality","address","region","postcode","country","poi"
            select "value", image_hash from loctable where "key" not in ('"postcode"','"poi"') group by "value", image_hash
        )
        select "value", count(*) from OneWordPerPhoto group by "value" order by count(*) desc limit 100
    """
    for type in ("captions", "people", "locations"):
        with connection.cursor() as cursor:
            cursor.execute(query[type], {"userid": user.id})
            for row in cursor.fetchall():
                out[type].append({"label": row[0], "y": np.log(row[1])})
    return out
