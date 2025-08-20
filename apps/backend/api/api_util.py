import os
import random
import stat

from api.models import (
    LongRunningJob,
    Photo,
)
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
        .exclude(caption_instance__captions_json={})
        .exclude(caption_instance__captions_json__isnull=True)[:1000]
        .values_list("image_hash", flat=True)
    )
    if len(possible_ids) > 99:
        possible_ids = random.choices(possible_ids, k=100)
    logger.info(f"{len(possible_ids)} possible ids")
    try:
        samples = (
            Photo.objects.filter(owner=user)
            .exclude(caption_instance__captions_json={})
            .exclude(caption_instance__captions_json__isnull=True)
            .filter(image_hash__in=possible_ids)
            .prefetch_related("faces")
            .prefetch_related("faces__person")
            .prefetch_related("caption_instance")
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
        if (
            p.geolocation_json
            and p.geolocation_json != {}
            and "features" in p.geolocation_json
        ):
            terms_loc = [
                f["text"]
                for f in p.geolocation_json["features"][-5:]
                if "text" in f and not f["text"].isdigit()
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
        if (
            p.caption_instance
            and p.caption_instance.captions_json
            and p.caption_instance.captions_json.get("places365") is not None
        ):
            terms_things = p.caption_instance.captions_json["places365"]["categories"]

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
