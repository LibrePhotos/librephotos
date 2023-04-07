import datetime
import uuid

import numpy as np
import pytz
import seaborn as sns
from bulk_update.helper import bulk_update
from django.db.models import Q
from django_rq import job
from hdbscan import HDBSCAN
from sklearn.decomposition import PCA
from sklearn.neural_network import MLPClassifier

from api.cluster_manager import ClusterManager
from api.models import Face, LongRunningJob, Person
from api.models.cluster import UNKNOWN_CLUSTER_ID, Cluster
from api.models.person import get_unknown_person
from api.models.user import User, get_deleted_user
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
        delete_persons_without_faces()
        target_count: int = create_all_clusters(user, lrj)

        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.result = {"progress": {"current": target_count, "target": target_count}}
        lrj.save()

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
    print("[INFO] Creating clusters")

    data = {
        "all": {"encoding": [], "id": []},
    }
    for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
        data["all"]["encoding"].append(face.get_encoding_array())
        data["all"]["id"].append(face.id)

    target_count = len(data["all"]["id"])
    if target_count == 0:
        return target_count
    # creating HDBSCAN object for clustering the encodings with the metric "euclidean"
    clt = HDBSCAN(min_cluster_size=2, metric="euclidean")

    clt.fit(np.array(data["all"]["encoding"]))

    labelIDs = np.unique(clt.labels_)
    labelID: np.intp
    commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
    count: int = 0
    maxLen: int = len(str(np.size(labelIDs)))
    sortedIndexes: dict[int, np.ndarray] = dict()
    clusterCount: int = 0
    clusterId: int

    for labelID in labelIDs:
        idxs = np.where(clt.labels_ == labelID)[0]
        sortedIndexes[labelID] = idxs

    for labelID in sorted(
        sortedIndexes, key=lambda key: np.size(sortedIndexes[key]), reverse=True
    ):
        if labelID != UNKNOWN_CLUSTER_ID:
            clusterCount = clusterCount + 1
            clusterId = clusterCount
        else:
            clusterId = labelID
        face_array: list[Face] = []
        face_id_list: list[int] = []
        for i in sortedIndexes[labelID]:
            count = count + 1
            face_id = data["all"]["id"][i]
            face_id_list.append(face_id)
        face_array = Face.objects.filter(pk__in=face_id_list)
        new_clusters: list[Cluster] = ClusterManager.try_add_cluster(
            user, clusterId, face_array, maxLen
        )

        if commit_time < datetime.datetime.now() and lrj is not None:
            lrj.result = {"progress": {"current": count, "target": target_count}}
            lrj.save()
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)

        all_clusters.extend(new_clusters)

    return target_count


def delete_persons_without_faces():
    """Delete all existing Person records that have no associated Face records"""
    print("[INFO] Deleting all people without faces")
    Person.objects.filter(faces=None, kind=Person.KIND_USER).delete()


def delete_clusters(user: User):
    """Delete all existing Cluster records"""
    print("[INFO] Deleting all clusters")
    Cluster.objects.filter(Q(owner=user)).delete()
    Cluster.objects.filter(Q(owner=None)).delete()
    Cluster.objects.filter(Q(owner=get_deleted_user())).delete()


def delete_clustered_people(user: User):
    """Delete all existing Person records of type CLUSTER"""
    print("[INFO] Deleting all clustered people")
    Person.objects.filter(kind=Person.KIND_CLUSTER, cluster_owner=user).delete()
    Person.objects.filter(cluster_owner=None).delete()
    Person.objects.filter(cluster_owner=get_deleted_user()).delete()


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
    unknown_person: Person = get_unknown_person(owner=user)
    try:
        # Use two array, so that the first one gets thrown out, if it is no longer used.
        data_known = {"encoding": [], "id": []}
        data_unknown = {"encoding": [], "id": []}
        # First, sort all faces into known and unknown ones
        face: Face
        for face in Face.objects.filter(
            Q(photo__owner=user) & ~Q(person=unknown_person)
        ).prefetch_related("person"):
            person: Person = face.person
            unknown = (
                face.person_label_is_inferred is not False
                or person.kind == Person.KIND_CLUSTER
            )
            if unknown:
                data_unknown["encoding"].append(face.get_encoding_array())
                data_unknown["id"].append(face.id if unknown else face.person.id)
            else:
                data_known["encoding"].append(face.get_encoding_array())
                data_known["id"].append(face.id if unknown else face.person.id)

        # Next, pretend all unknown face clusters are known and add their mean encoding. This allows us
        # to predict the likelihood of other unknown faces belonging to those simulated clusters. For
        # the "Unknown - Other"-type cluster, we can still try to predict the probability that the face
        # can't be classified into another group, i.e. that it should be classified that way
        cluster: Cluster
        for cluster in Cluster.objects.filter(owner=user):
            if cluster.person.kind == Person.KIND_CLUSTER:
                data_known["encoding"].append(cluster.get_mean_encoding_array())
                data_known["id"].append(cluster.person.id)

        if len(data_known["id"]) == 0:
            logger.info("No labeled faces found")
            lrj.finished = True
            lrj.failed = False
            lrj.result = {"progress": {"current": 2, "target": 2}}
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
        else:
            # Fit the classifier based on the "known" faces, including the simulated clusters
            logger.info("Before fitting")
            clf = MLPClassifier(
                solver="adam", alpha=1e-5, random_state=1, max_iter=1000
            ).fit(np.array(data_known["encoding"]), np.array(data_known["id"]))
            logger.info("After fitting")

            # Collect the probabilities for each unknown face. The probabilities returned
            # are arrays in the same order as the people IDs in the original training set
            target_count = len(data_unknown["id"])
            logger.info("Number of Cluster: {}".format(target_count))
            if target_count != 0:
                # Hacky way to split arrays into smaller arrays
                pages_encoding = [
                    data_unknown["encoding"][i : i + 100]
                    for i in range(0, len(data_unknown["encoding"]), 100)
                ]
                pages_id = [
                    data_unknown["id"][i : i + 100]
                    for i in range(0, len(data_unknown["encoding"]), 100)
                ]
                for idx, page_data_unknown_encoding in enumerate(pages_encoding):
                    page_data_unknown_id = pages_id[idx]
                    face_encodings_unknown_np = np.array(page_data_unknown_encoding)
                    probs = clf.predict_proba(face_encodings_unknown_np)

                    commit_time = datetime.datetime.now() + datetime.timedelta(
                        seconds=5
                    )
                    face_stack = []
                    for idx, (face_id, probability_array) in enumerate(
                        zip(page_data_unknown_id, probs)
                    ):
                        face = Face.objects.get(id=face_id)
                        if face.person is unknown_person:
                            face.person_label_is_inferred = False
                        else:
                            face.person_label_is_inferred = True
                        probability: np.float64 = 0

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
