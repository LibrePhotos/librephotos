import datetime
import uuid

import numpy as np
import math
import scipy
import pytz
import seaborn as sns
from bulk_update.helper import bulk_update
from django.core.cache import cache
from django_rq import job
from sklearn.cluster import DBSCAN
from sklearn.decomposition import PCA
from sklearn.neural_network import MLPClassifier

from api.models import Face, LongRunningJob, Person
from api.models.person import get_or_create_person, get_unknown_person
from api.serializers.serializers import FaceSerializer
from api.util import logger

FACE_CLASSIFY_COLUMNS = [
    "person",
    "person_label_is_inferred",
    "person_label_probability",
    "id",
]

def cluster_faces(user, inferred=True):
    # for front end cluster visualization
    persons = [p.id for p in Person.objects.filter(faces__photo__owner=user).distinct()]
    p2c = dict(zip(persons, sns.color_palette(n_colors=len(persons)).as_hex()))

    face_encoding = []
    faces = Face.objects.filter(photo__owner=user)
    face:Face
    for face in faces:
        if (not face.person_label_is_inferred) or inferred:
            face_encoding.append(face.get_encoding_array())

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


@job
def cluster_unlabeled_faces(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_CLUSTER_UNLABELED_FACES
        )
    lrj.result = {"progress": {"current": 0, "target": 1}}
    lrj.save()

    try:
        delete_clustered_persons(user)
        data = {
            "known": {"encoding": [], "id": []},
            "unknown": {"encoding": [], "id": []},
        }
        logger.info("Clustering unlabeled faces")
        face:Face
        for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
            unknown = (
                    face.person_label_is_inferred is not False
                    or face.person.name == "unknown"
            )
            data_type = "unknown" if unknown else "known"
            data[data_type]["encoding"].append(face.get_encoding_array())
            data[data_type]["id"].append(face.id if unknown else face.person.id)

        # creating DBSCAN object for clustering the encodings with the metric "euclidean"
        clt = DBSCAN(metric="euclidean", min_samples=3)
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
        target_count = numUniqueFaces

        commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)

        # loop over the unique face integers

        face_stack = []
        for labelID in labelIDs:
            if labelID > -1:
                if commit_time < datetime.datetime.now():
                    lrj.result = {"progress": {"current": labelID + 1, "target": target_count}}
                    lrj.save()
                    commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
                # find all indexes into the `data` array that belong to the
                # current label ID
                idxs = np.where(clt.labels_ == labelID)[0]

                # Add a new person to the database for the current label ID
                personName="Unknown " + str(labelID + 1)
                new_person: Person = get_or_create_person(name=personName)
                new_person.kind = Person.KIND_CLUSTER
                new_person.cluster_id = labelID
                new_person.account = user
                new_person.save()

                cluster_vectors = collect_vectors(clt, labelID, data)

                mean_vector = find_mean_vector(cluster_vectors)
                print("mean vector for labelID {}: {}".format(labelID, mean_vector))
                n_dimension_stats = find_n_dimension_stats(cluster_vectors)
                mean_distance = n_dimension_stats[0]
                std_dev_distance = n_dimension_stats[1]
                # loop over the sampled indexes
                for i in idxs:
                    new_person = Person.objects.filter(name=personName).first()
                    # find the face id for the face in the current image
                    face_id = data["unknown"]["id"][i]
                    face:Face = Face.objects.filter(id=face_id).first()
                    distance = math.dist(face.get_encoding_array(),mean_vector)
                    z_score = abs(distance/mean_distance)

                    face.person_id = new_person.id
                    face.person_label_is_inferred = True
                    face.person_label_probability = 1 - scipy.stats.norm.sf(z_score)
                    print("mean: {}, distance: {}, z_score: {}, prob: {}".format(mean_distance,distance,z_score,face.person_label_probability))
                    face_stack.append(face)
                    if len(face_stack)>200:
                        bulk_update(face_stack,update_fields=FACE_CLASSIFY_COLUMNS)
                        face_stack = []
        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)

        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.result = {"progress": {"current": target_count, "target": target_count}}
        lrj.save()
        cache.clear()
        return True
    except BaseException:
        logger.exception("An error occurred")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False

def collect_vectors(clt, labelID, data):
    idxs = np.where(clt.labels_ == labelID)[0]
    all_vectors = []

    for i in idxs:
        face_id = data["unknown"]["id"][i]
        face: Face = Face.objects.filter(id=face_id).first()
        vector = face.get_encoding_array()
        all_vectors.append(vector)
    
    return all_vectors

def find_n_dimension_stats(all_vectors):
    mean_vector = find_mean_vector(all_vectors)
    distance_ary = []
    for vector in all_vectors:
        distance_ary.append(math.dist(vector,mean_vector))

    return [
        np.mean(a=distance_ary,dtype=np.float64),
        np.std(a=distance_ary,dtype=np.float64)
    ]

def find_mean_vector(all_vectors):
    return np.mean(a=all_vectors,axis=0, dtype=np.float64)


def delete_clustered_persons(user):
    for person in Person.objects.filter(kind=Person.KIND_CLUSTER, account=user):
        for face in Face.objects.filter(person=person):
            face.person = get_unknown_person()
        person.delete()

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
        face:Face
        for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
            unknown = (
                    face.person_label_is_inferred is not False
                    or face.person.name == "unknown"
            )
            data_type = "unknown" if unknown else "known"
            data[data_type]["encoding"].append(
                face.get_encoding_array() 
            )
            data[data_type]["id"].append(face.id if unknown else face.person.id)

        if len(data["known"]["id"]) == 0:
            logger.debug("No labeled faces found")
            lrj.finished = True
            lrj.failed = False
            lrj.result = {"progress": {"current": 2, "target": 2}}
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
        else:

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
                    bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
                    face_stack = []

            bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
            lrj.finished = True
            lrj.failed = False
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.result = {"progress": {"current": target_count, "target": target_count}}
            lrj.save()
            cache.clear()

        cluster_job_id = uuid.uuid4()
        cluster_unlabeled_faces.delay(user, cluster_job_id)

        return True

    except BaseException:
        logger.exception("An error occurred")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False
