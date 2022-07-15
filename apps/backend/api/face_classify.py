import datetime
import string
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
from api.cluster_manager import ClusterManager

from api.models import Face, LongRunningJob, Person
from api.models.cluster import Cluster
from api.models.person import get_or_create_person, get_unknown_person
from api.models.user import User
from api.serializers.serializers import FaceSerializer
from api.util import logger

FACE_CLASSIFY_COLUMNS = [
    "person",
    "person_label_is_inferred",
    "person_label_probability",
    "id",
    "cluster",
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
    cluster_manager: ClusterManager = ClusterManager()

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
        delete_clustered_people()
        delete_clusters(cluster_manager)
        target_count: int = len(create_all_clusters(cluster_manager, user))

        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.result = {"progress": {"current": target_count, "target": target_count}}
        lrj.save()
        cache.clear()
        return True
 
    except BaseException as err:
        logger.exception("An error occurred")
        print("[ERR] {}".format(err))
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False

def create_all_clusters(cluster_manager: ClusterManager, user: User, lrj: LongRunningJob = None) -> list[Cluster]:
    all_clusters: list[Cluster] = []
    face:Face
    print("creating clusters")
    
    data = {
        "all": {"encoding": [], "id": []},
    }
    for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
        data["all"]["encoding"].append(face.get_encoding_array())
        data["all"]["id"].append(face.id)

    # creating DBSCAN object for clustering the encodings with the metric "euclidean"
    clt = DBSCAN(metric="euclidean", min_samples=3)
    
    clt.fit(np.array(data["all"]["encoding"]))

    labelIDs = np.unique(clt.labels_)
    labelID: np.intp
    commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
    target_count = len(labelIDs)
    count: int = 0

    for labelID in labelIDs:
        print("[INFO] Generating cluster for: {}".format(labelID))
        count = count + 1
        idxs = np.where(clt.labels_ == labelID)[0]
        cluster_vectors = []
        print("idxs: {}".format(idxs))
        face_array: list[Face] = []
        for i in idxs:
            face_id = data["all"]["id"][i]
            face = Face.objects.filter(id=face_id).first()
            face_array.append(face)
        new_clusters: list[Cluster] = cluster_manager.try_add_cluster(labelID, face_array)
        
        if commit_time < datetime.datetime.now() and lrj != None:
            lrj.result = {"progress": {"current": count, "target": target_count}}
            lrj.save()
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)

        all_clusters.extend(new_clusters)
    
    return all_clusters


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

def delete_clusters(cluster_manager: ClusterManager):
    print("deleting clusters")
    cluster:Cluster
    for cluster in Cluster.objects.filter():
        print("deleting cluster {}".format(cluster))
        cluster_manager.delete_cluster(cluster)

def delete_clustered_people():
    for person in Person.objects.filter(kind=Person.KIND_CLUSTER):
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
