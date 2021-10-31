import datetime

import numpy as np
import pytz
import seaborn as sns
from bulk_update.helper import bulk_update
from django.core.cache import cache
from django_rq import job
from sklearn.cluster import DBSCAN
from sklearn.decomposition import PCA
from sklearn.neural_network import MLPClassifier

from api.models import Face, LongRunningJob, Person
from api.util import logger


def cluster_faces(user, inferred=True):
    # for front end cluster visualization
    persons = [p.id for p in Person.objects.filter(faces__photo__owner=user).distinct()]
    p2c = dict(zip(persons, sns.color_palette(n_colors=len(persons)).as_hex()))

    face_encoding = []
    faces = Face.objects.filter(photo__owner=user)
    for face in faces:
        if (not face.person_label_is_inferred) or inferred:
            face_encoding.append(np.frombuffer(bytes.fromhex(face.encoding)))

    pca = PCA(n_components=3)
    vis_all = pca.fit_transform(face_encoding)

    res = []
    for face, vis in zip(faces, vis_all):
        res.append(
            {
                "person_id": face.person.id,
                "person_name": face.person.name,
                "person_label_is_inferred": face.person_label_is_inferred,
                "color": p2c[face.person.id],
                "face_url": face.image.url,
                "value": {"x": vis[0], "y": vis[1], "size": vis[2]},
            }
        )
    return res


def cluster_unknown_faces(user, job_id):
    try:
        data = {
            "known": {"encoding": [], "id": []},
            "unknown": {"encoding": [], "id": []},
        }
        for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
            unknown = (
                face.person_label_is_inferred is not False
                or face.person.name == "unknown"
            )
            data_type = "unknown" if unknown else "known"
            data[data_type]["encoding"].append(
                np.frombuffer(bytes.fromhex(face.encoding))
            )
            data[data_type]["id"].append(face.id if unknown else face.person.id)

        # creating DBSCAN object for clustering the encodings with the metric "euclidean"
        clt = DBSCAN(metric="euclidean")
        clt.fit(np.array(data["unknown"]["encoding"]))
        # determine the total number of unique faces found in the dataset
        # clt.labels_ contains the label ID for all faces in our dataset (i.e., which cluster each face belongs to).
        # To find the unique faces/unique label IDs, used NumPy’s unique function.
        # The result is a list of unique labelIDs
        labelIDs = np.unique(clt.labels_)
        # we count the numUniqueFaces . There could potentially be a value of -1 in labelIDs — this value corresponds
        # to the “outlier” class where a 128-d embedding was too far away from any other clusters to be added to it.
        # “outliers” could either be worth examining or simply discarding based on the application of face clustering.
        numUniqueFaces = len(np.where(labelIDs > -1)[0])
        print("[INFO] # unique faces: {}".format(numUniqueFaces))

        # loop over the unique face integers
        for labelID in labelIDs:
            if labelID > -1:
                # find all indexes into the `data` array that belong to the
                # current label ID
                print("[INFO] faces for face ID: {}".format(labelID))
                idxs = np.where(clt.labels_ == labelID)[0]
                # Add a new person to the database for the current label ID
                new_person = Person()
                new_person.name = "Group" + str(labelID) + str(job_id)
                new_person.save()
                # loop over the sampled indexes
                for i in idxs:
                    new_person = Person.objects.filter(
                        name="Group" + str(labelID) + str(job_id)
                    ).first()
                    # find the face id for the face in the current image
                    face_id = data["unknown"]["id"][i]
                    face = Face.objects.filter(id=face_id).first()
                    face.person_id = new_person.id
                    face.person_label_is_inferred = False
                    face.person_label_probability = 1.0
                    face.save()
        return True
    except BaseException:
        logger.exception("An error occured")
        return False


@job
def train_faces(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_TRAIN_FACES,
        )
    lrj.result = {"progress": {"current": 1, "target": 2}}
    lrj.save()

    try:
        data = {
            "known": {"encoding": [], "id": []},
            "unknown": {"encoding": [], "id": []},
        }
        for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
            unknown = (
                face.person_label_is_inferred is not False
                or face.person.name == "unknown"
            )
            data_type = "unknown" if unknown else "known"
            data[data_type]["encoding"].append(
                np.frombuffer(bytes.fromhex(face.encoding))
            )
            data[data_type]["id"].append(face.id if unknown else face.person.id)

        if len(data["known"]["id"]) == 0:
            logger.debug("No labeled faces found")
            lrj.finished = True
            lrj.failed = False
            lrj.result = {"progress": {"current": 2, "target": 2}}
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
            return True

        logger.debug("Before fitting")
        clf = MLPClassifier(
            solver="adam", alpha=1e-5, random_state=1, max_iter=1000
        ).fit(np.array(data["known"]["encoding"]), np.array(data["known"]["id"]))
        logger.debug("After fitting")

        face_encodings_unknown_np = np.array(data["unknown"]["encoding"])
        pred = clf.predict(face_encodings_unknown_np)
        probs = np.max(clf.predict_proba(face_encodings_unknown_np), 1)
        target_count = len(data["unknown"]["id"])

        commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
        face_stack = []
        columns = [
            "person",
            "person_label_is_inferred",
            "person_label_probability",
            "id",
        ]
        for idx, (face_id, person_id, probability) in enumerate(
            zip(data["unknown"]["id"], pred, probs)
        ):
            face = Face.objects.get(id=face_id)
            face.person_id = person_id
            face.person_label_is_inferred = True
            face.person_label_probability = probability
            face_stack.append(face)
            if commit_time < datetime.datetime.now():
                lrj.result = {"progress": {"current": idx + 1, "target": target_count}}
                lrj.save()
                commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
            if len(face_stack) > 200:
                bulk_update(face_stack, update_fields=columns)
                face_stack = []

        bulk_update(face_stack, update_fields=columns)
        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.result = {"progress": {"current": target_count, "target": target_count}}
        lrj.save()
        cache.clear()
        return True

    except BaseException:
        logger.exception("An error occured")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False
