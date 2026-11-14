"""Drive one backend through the E2E ML run and dump its ML rows.

usage: drive.py <rs|dj> <base_url> <db> <out.json>

Same HTTP calls for both backends: scan, train faces, OCR, a caption per
photo, the photo detail (similar_photos). Waits for the job queue to go quiet
between steps. Then reads faces, tags, captions, OCR and CLIP rows from the DB.
E2E_DUMP_ONLY=1 skips the steps and redoes the lookups and the dump.
"""

import json
import os
import sys
import time

import psycopg
import requests

role, base, db, out = sys.argv[1:5]
USER, PW = "mlcheck", "mlcheck-pw"
conn = psycopg.connect(f"host=localhost port=5433 user=postgres password=x dbname={db}", autocommit=True)


def q(sql, *args):
    with conn.cursor() as c:
        c.execute(sql, args)
        return c.fetchall()


uid = q("SELECT id FROM api_user WHERE username = %s", USER)[0][0]


class Http:
    """requests with a fresh login whenever the 5-minute access token expired."""

    def __init__(self):
        self.s = requests.Session()
        self.login()

    def login(self):
        tok = self.s.post(f"{base}/api/auth/token/obtain/", json={"username": USER, "password": PW}, timeout=60)
        tok.raise_for_status()
        self.s.headers["Authorization"] = "Bearer " + tok.json()["access"]

    def __getattr__(self, method):
        def call(*a, **kw):
            r = getattr(self.s, method)(*a, **kw)
            if r.status_code == 401:
                self.login()
                r = getattr(self.s, method)(*a, **kw)
            return r
        return call


http = Http()


def busy():
    n = q("SELECT count(*) FROM api_longrunningjob WHERE started_by_id = %s AND NOT finished", uid)[0][0]
    if role == "rs":
        n += q(
            "SELECT count(*) FROM job_queue WHERE kind NOT LIKE 'maintenance.%%' AND "
            "(status = 'running' OR (status = 'queued' AND run_after <= now()))"
        )[0][0]
    else:
        n += q("SELECT count(*) FROM django_q_ormq")[0][0]
    return n


def wait_quiet(label, limit=900):
    t0 = time.time()
    quiet = 0
    while time.time() - t0 < limit:
        time.sleep(2)
        quiet = quiet + 1 if busy() == 0 else 0
        if quiet >= 4:
            break
    dt = time.time() - t0 - 8
    print(f"{role}: {label} done in {dt:.1f} s", flush=True)
    return round(dt, 1)


DUMP_ONLY = os.environ.get("E2E_DUMP_ONLY") == "1"
timing = {}
t = time.time()
if DUMP_ONLY:
    prev = json.load(open(out, encoding="utf8"))
    timing = prev["timing"]
r = None if DUMP_ONLY else http.post(f"{base}/api/scanphotos/", json={}, timeout=600)
if not DUMP_ONLY:
    print(role, "scan", r.status_code, r.text[:200], flush=True)
    timing["scan+followups"] = wait_quiet("scan + tags/clip/faces")

    r = http.post(f"{base}/api/trainfaces/", json={}, timeout=600)
    print(role, "train", r.status_code, r.text[:200], flush=True)
    timing["train_faces"] = wait_quiet("face clustering")

    r = http.post(f"{base}/api/generateocr/", json={"full_scan": True}, timeout=600)
    print(role, "ocr", r.status_code, r.text[:200], flush=True)
    timing["ocr"] = wait_quiet("ocr")

photos = q(
    """SELECT p.id::text, p.image_hash, f.path FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id
       WHERE p.owner_id = %s ORDER BY f.path""",
    uid,
)
print(role, len(photos), "photos", flush=True)
if DUMP_ONLY:
    cap_status = {v["hash"]: v["caption_status"] for v in prev["photos"].values()}
else:
    t0 = time.time()
    cap_status = {}
    for _pid, h, path in photos:
        r = http.post(f"{base}/api/photosedit/generateim2txt", json={"image_hash": h}, timeout=900)
        cap_status[h] = r.status_code
    timing["captions"] = round(time.time() - t0, 1)
    print(f"{role}: captions done in {timing['captions']} s", flush=True)

similar = {}
t0 = time.time()
for _pid, h, _ in photos:
    r = http.get(f"{base}/api/photos/{h}/", timeout=120)
    sp = r.json().get("similar_photos", []) if r.ok else None
    similar[h] = sorted(x.get("image_hash") for x in sp) if sp is not None else None
timing["similar_lookups"] = round(time.time() - t0, 1)
if not DUMP_ONLY:
    timing["total"] = round(time.time() - t, 1)

rows = {}
for pid, h, path in photos:
    name = path.replace("\\", "/").rsplit("/", 1)[-1]
    faces = q(
        """SELECT location_top, location_right, location_bottom, location_left, encoding,
                  person_id, cluster_id, cluster_person_id, classification_person_id, deleted
           FROM api_face WHERE photo_id = %s::uuid ORDER BY location_left, location_top""",
        pid,
    )
    cap = q("SELECT captions_json FROM api_photo_caption WHERE photo_id = %s::uuid", pid)
    ocr = q("SELECT text, engine FROM api_photo_ocr WHERE photo_id = %s::uuid", pid)
    clip = q("SELECT clip_embeddings FROM api_photo WHERE id = %s::uuid", pid)
    rows[name] = {
        "hash": h,
        "faces": [list(f) for f in faces],
        "captions_json": cap[0][0] if cap else None,
        "ocr": ocr[0][0] if ocr else None,
        "clip": clip[0][0] if clip else None,
        "similar": similar[h],
        "caption_status": cap_status[h],
    }
persons = dict(q("SELECT id, name FROM api_person"))
jobs = q(
    "SELECT job_type, finished, failed, result::text FROM api_longrunningjob WHERE started_by_id = %s ORDER BY queued_at",
    uid,
)
json.dump(
    {"role": role, "timing": timing, "photos": rows, "persons": {str(k): v for k, v in persons.items()},
     "jobs": [list(j) for j in jobs]},
    open(out, "w", encoding="utf8"),
    default=str,
)
print(role, "timing", timing, flush=True)
