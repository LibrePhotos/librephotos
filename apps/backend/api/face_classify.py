import datetime
import uuid

import numpy as np
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
from api.models.person import get_unknown_person
from api.models.user import User
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
    face: Face
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
def cluster_all_faces(user, job_id) -> bool:
    """Groups all faces into clusters for ease of labeling. It first deletes all
    existing clusters, then regenerates them all. It will split clusters that have
    more than one kind of labeled face.
    :param user: the current user running the training
    :param job_id: the background job ID
    """
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_CLUSTER_ALL_FACES,
        )
    lrj.result = {"progress": {"current": 0, "target": 1}}
    lrj.save()

    try:
        delete_clustered_people(user)
        delete_clusters(user)
        target_count: int = create_all_clusters(user)

        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.result = {"progress": {"current": target_count, "target": target_count}}
        lrj.save()
        cache.clear()

        train_job_id = uuid.uuid4()
        train_faces.delay(user, train_job_id)
        return True

    except BaseException as err:
        logger.exception("An error occurred")
        print("[ERR] {}".format(err))
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False


def create_all_clusters(user: User, lrj: LongRunningJob = None) -> int:
    """Generate Cluster records for each different clustering of people
    :param user: the current user
    :param lrj: LongRunningJob to update, if needed
    """
    all_clusters: list[Cluster] = []
    face: Face
    print("creating clusters")

    data = {
        "all": {"encoding": [], "id": []},
    }
    for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
        data["all"]["encoding"].append(face.get_encoding_array())
        data["all"]["id"].append(face.id)

    # creating DBSCAN object for clustering the encodings with the metric "euclidean"
    clt = DBSCAN(metric="euclidean", min_samples=2)

    clt.fit(np.array(data["all"]["encoding"]))

    labelIDs = np.unique(clt.labels_)
    labelID: np.intp
    commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
    target_count = len(data["all"]["id"])
    count: int = 0

    for labelID in labelIDs:
        idxs = np.where(clt.labels_ == labelID)[0]
        face_array: list[Face] = []
        for i in idxs:
            count = count + 1
            face_id = data["all"]["id"][i]
            face = Face.objects.filter(id=face_id).first()
            face_array.append(face)
        new_clusters: list[Cluster] = ClusterManager.try_add_cluster(
            user, labelID, face_array
        )

        if commit_time < datetime.datetime.now() and lrj is not None:
            lrj.result = {"progress": {"current": count, "target": target_count}}
            lrj.save()
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)

        all_clusters.extend(new_clusters)

    return target_count


def delete_clusters(user: User):
    """Delete all existing Cluster records"""
    print("[INFO] deleting all clusters")
    cluster: Cluster
    for cluster in Cluster.objects.filter(owner=user):
        if cluster != ClusterManager.get_unknown_cluster():
            ClusterManager.delete_cluster(cluster)


def delete_clustered_people(user: User):
    """Delete all existing Person records of type CLUSTER"""
    print("[INFO] deleting all clustered people")
    for person in Person.objects.filter(kind=Person.KIND_CLUSTER, cluster_owner=user):
        for face in Face.objects.filter(person=person):
            face.person = get_unknown_person()
        person.delete()


@job
def train_faces(user: User, job_id) -> bool:
    """Given existing Cluster records for all faces, determines the probability
    that unknown faces belong to those Clusters. It takes any known, labeled faces
    and adds the centroids of "unknown" clusters, assuming that those clusters
    correspond to *some* face. It then trains a classifier on that data to use
    in calculating the probabilities for unknown faces.
    :param user: the current user running the training
    :param job_id: the background job ID
    """
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
        # First, sort all faces into known and unknown ones
        face: Face
        for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
            person: Person = face.person
            unknown = (
                face.person_label_is_inferred is not False
                or person.kind == Person.KIND_CLUSTER
            )
            data_type = "unknown" if unknown else "known"
            data[data_type]["encoding"].append(face.get_encoding_array())
            data[data_type]["id"].append(face.id if unknown else face.person.id)

        # Next, pretend all unknown face clusters are known and add their mean encoding. This allows us
        # to predict the likelihood of other unknown faces belonging to those simulated clusters. For
        # the "Unknown - Other"-type cluster, we can still try to predict the probability that the face
        # can't be classified into another group, i.e. that it should be classified that way
        cluster: Cluster
        for cluster in Cluster.objects.all():
            if cluster.person.kind == Person.KIND_CLUSTER:
                data["known"]["encoding"].append(cluster.get_mean_encoding_array())
                data["known"]["id"].append(cluster.person.id)

        if len(data["known"]["id"]) == 0:
            logger.debug("No labeled faces found")
            lrj.finished = True
            lrj.failed = False
            lrj.result = {"progress": {"current": 2, "target": 2}}
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
        else:

            # Fit the classifier based on the "known" faces, including the simulated clusters
            logger.debug("Before fitting")
            clf = MLPClassifier(
                solver="adam", alpha=1e-5, random_state=1, max_iter=1000
            ).fit(np.array(data["known"]["encoding"]), np.array(data["known"]["id"]))
            logger.debug("After fitting")

            # Collect the probabilities for each unknown face. The probabilities returned
            # are arrays in the same order as the people IDs in the original training set
            face_encodings_unknown_np = np.array(data["unknown"]["encoding"])
            probs = clf.predict_proba(face_encodings_unknown_np)
            target_count = len(data["unknown"]["id"])

            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
            face_stack = []
            for idx, (face_id, probability_array) in enumerate(
                zip(data["unknown"]["id"], probs)
            ):
                face = Face.objects.get(id=face_id)
                face.person_label_is_inferred = True
                probability: np.float64

                # Find the probability in the probability array corresponding to the person
                # that we currently believe the face is, even a simulated "unknown" person
                for i, target in enumerate(clf.classes_):
                    if target == face.person.id:
                        probability = probability_array[i]
                        break
                face.person_label_probability = probability
                face_stack.append(face)
                if commit_time < datetime.datetime.now():
                    lrj.result = {
                        "progress": {"current": idx + 1, "target": target_count}
                    }
                    lrj.save()
                    commit_time = datetime.datetime.now() + datetime.timedelta(
                        seconds=5
                    )
                if len(face_stack) > 200:
                    bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
                    face_stack = []

            bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
            lrj.finished = True
            lrj.failed = False
            lrj.result = {"progress": {"current": target_count, "target": target_count}}
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
            return True

    except BaseException as err:
        logger.exception("An error occurred")
        print("[ERR] {}".format(err))
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False
