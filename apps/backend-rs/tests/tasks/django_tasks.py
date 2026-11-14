"""Run one Django background task synchronously, as the reference side of a
tasks differential run (tests/tasks/README.md).

    python django_tasks.py <job> <username> --mock URL [--photo UUID] [--setting K=V] [--incremental]

Jobs: classify, tags, ocr, geo, clip, faces, cluster, train, caption.
Environment as for run_django.sh (lp_django_env) plus FEATURE_* on.

Stand-ins, so the task code itself runs unchanged:
* every sidecar call goes to ``--mock`` (tests/tasks/mock_sidecars.py);
* metadata reads run the exif sidecar's own code in-process
  (service/exif/main.py) instead of calling port 8010, which is shared;
* Nominatim is the mock too; django-q tasks run inline.
"""

import argparse
import os
import sys
import uuid


def setup(mock):
    import django

    django.setup()

    from api import sidecars

    sidecars.sidecar_url = lambda service, path="": f"{mock}{path}"

    # The exif sidecar's code, in-process.
    from api.metadata import reader
    from service.exif import main as exif_main

    def get_metadata(media_file, tags, try_sidecar=True, struct=False):
        files = reader._get_existing_metadata_files_reversed(media_file, try_sidecar)
        et = exif_main.running_exiftool(struct)
        values = exif_main.highest_priority_values(et, tags, files)
        return list(values) + [None] * (len(tags) - len(values))

    import api.face_extractor
    import api.geocode.photo_location

    api.face_extractor.get_metadata = get_metadata
    api.geocode.photo_location.get_metadata = get_metadata
    reader.get_metadata = get_metadata

    # Nominatim at the mock.
    from api.geocode import config as geo_config

    original = geo_config._get_config

    def _get_config():
        cfg = original()
        host = mock.split("://", 1)[1]
        cfg["nominatim"]["geocode_args"].update({"domain": host, "scheme": "http"})
        return cfg

    geo_config._get_config = _get_config

    # django-q tasks inline.
    class InlineTask:
        def __init__(self, func, *args, **kwargs):
            self.func, self.args, self.kwargs = func, args, kwargs

        def run(self):
            self.func(*self.args, **self.kwargs)

    import api.directory_watcher.processing_jobs as processing_jobs
    import api.face_classify as face_classify

    processing_jobs.AsyncTask = InlineTask
    face_classify.AsyncTask = InlineTask


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("job")
    parser.add_argument("username")
    parser.add_argument("--mock", required=True)
    parser.add_argument("--photo")
    parser.add_argument("--incremental", action="store_true")
    parser.add_argument("--setting", action="append", default=[], help="KEY=VALUE site setting")
    args = parser.parse_args()
    setup(args.mock.rstrip("/"))

    from constance import config

    for item in args.setting:
        key, _, value = item.partition("=")
        setattr(config, key, value)

    from api.models import User

    user = User.objects.get(username=args.username)
    full = not args.incremental
    job_id = uuid.uuid4()
    from api.directory_watcher import processing_jobs as pj

    if args.job == "classify":
        pj.classify_media(user, job_id)
    elif args.job == "tags":
        pj.generate_tags(user, job_id, full)
    elif args.job == "ocr":
        pj.generate_ocr(user, job_id, full)
    elif args.job == "geo":
        pj.add_geolocation(user, job_id, full)
    elif args.job == "clip":
        from api.batch_jobs import batch_calculate_clip_embedding

        batch_calculate_clip_embedding(user)
    elif args.job == "faces":
        pj.scan_faces(user, job_id, full)
    elif args.job == "cluster":
        from api.directory_watcher import generate_face_embeddings
        from api.face_classify import cluster_all_faces

        generate_face_embeddings(user, uuid.uuid4())
        cluster_all_faces(user, job_id)
    elif args.job == "train":
        from api.face_classify import train_faces

        train_faces(user, job_id)
    elif args.job == "caption":
        from api.models import Photo
        from api.models.photo_caption import PhotoCaption

        photo = Photo.objects.get(pk=args.photo)
        caption, _ = PhotoCaption.objects.get_or_create(photo=photo)
        print("caption ok:", caption.generate_captions_im2txt())
    else:
        sys.exit(f"unknown job {args.job}")
    print(f"django {args.job} for {args.username} done", flush=True)
    # The in-process exif code keeps -stay_open ExifTools running, and
    # interpreter shutdown waits on them.
    from service.exif import main as exif_main

    for et in (exif_main.static_et, exif_main.static_struct_et):
        if et.running:
            et.terminate()
    os._exit(0)


if __name__ == "__main__":
    main()
