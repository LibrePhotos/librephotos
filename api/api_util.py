import os
import random
import stat
from collections import Counter
from datetime import datetime
from itertools import groupby

import numpy as np
import pandas as pd
import seaborn as sns
from django.core.paginator import Paginator
from django.db import connection
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth

from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumUser,
    Face,
    LongRunningJob,
    Person,
    Photo,
)
from api.serializers.serializers import LongRunningJobSerializer
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
    city_start_end_duration = []
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

    pp = Photo.objects.filter(owner=user).exclude(captions_json={})
    possible_ids = list(pp.values_list("image_hash", flat=True))
    if len(possible_ids) > 99:
        possible_ids = random.choices(possible_ids, k=100)
    logger.info(f"{len(possible_ids)} possible ids")
    try:
        samples = (
            pp.filter(image_hash__in=possible_ids)
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
            terms_people = [f.person.name.split(" ")[0] for f in faces]
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

    return list(set(search_terms))


def get_count_stats(user):
    num_photos = Photo.visible.filter(Q(owner=user)).count()
    num_missing_photos = Photo.objects.filter(Q(owner=user) & Q(image_paths=[])).count()
    num_faces = Face.objects.filter(photo__owner=user).count()
    num_unknown_faces = Face.objects.filter(
        Q(person__name__exact="unknown") & Q(photo__owner=user)
    ).count()
    num_labeled_faces = Face.objects.filter(
        Q(person_label_is_inferred=False)
        & ~Q(person__name__exact="unknown")
        & Q(photo__owner=user)
        & Q(photo__hidden=False)
    ).count()
    num_inferred_faces = Face.objects.filter(
        Q(person_label_is_inferred=True) & Q(photo__owner=user) & Q(photo__hidden=False)
    ).count()
    num_people = (
        Person.objects.filter(
            Q(faces__photo__hidden=False)
            & Q(faces__photo__owner=user)
            & Q(faces__person_label_is_inferred=False)
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


def get_photo_country_counts(user):
    with connection.cursor() as cursor:
        raw_sql = """
            SELECT
                DISTINCT ON(jsonb_extract_path("feature", 'place_name')) jsonb_extract_path("feature", 'place_name') "place_name"
                , COUNT(jsonb_extract_path("feature", 'place_name'))
            FROM
                "api_photo"
                , jsonb_array_elements(jsonb_extract_path("api_photo"."geolocation_json", 'features')) "feature"
            WHERE
                (
                    "api_photo"."owner_id" = %s
                    AND jsonb_extract_path_text("feature", 'place_type', '0') = 'country'
                )
            GROUP BY
                "place_name";
        """
        cursor.execute(raw_sql, [user.id])
        return Counter({row[0]: row[1] for row in cursor.fetchall()})


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
    query[
        "captions"
    ] = """
        with captionList as (
            select unnest(regexp_split_to_array(search_captions,' , ')) caption
            from api_photo where owner_id = %(userid)s
        )
        select caption, count(*) from captionList group by caption order by count(*) desc limit 100;
    """
    query[
        "people"
    ] = """
        with NameList as (
            select api_person.name
            from api_photo join api_face on image_hash = api_face.photo_id
            join api_person on person_id = api_person.id
            where owner_id = %(userid)s
        )
        select name, count(*) from NameList group by name order by count(*) desc limit 100;
    """
    query[
        "locations"
    ] = """
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
