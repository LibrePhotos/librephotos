import datetime
import uuid

import numpy as np
import pytz
import seaborn as sns
from bulk_update.helper import bulk_update
from django.core.paginator import Paginator
from django.db.models import Q
from django_q.tasks import AsyncTask
from hdbscan import HDBSCAN
from sklearn.decomposition import PCA
from sklearn.neural_network import MLPClassifier

from api.cluster_manager import ClusterManager
from api.models import Face, LongRunningJob, Person
from api.models.cluster import UNKNOWN_CLUSTER_ID, Cluster, get_unknown_cluster
from api.models.user import User, get_deleted_user
from api.util import logger

FACE_CLASSIFY_COLUMNS = [
    "person",
    "classification_person",
    "classification_probability",
    "cluster_person",
    "cluster_probability",
    "id",
    "cluster",
]


def cluster_faces(user, inferred=True):
    # Fetch distinct persons associated with the user's faces
    persons = [p.id for p in Person.objects.filter(faces__photo__owner=user).distinct()]

    # Create a color mapping for each person
    p2c = dict(zip(persons, sns.color_palette(n_colors=len(persons)).as_hex()))

    face_encoding = []
    # Fetch faces that belong to the user and are not deleted
    faces = Face.objects.filter(Q(photo__owner=user) & Q(deleted=False))
    paginator = Paginator(faces, 5000)

    for page in range(1, paginator.num_pages + 1):
        for face in paginator.page(page).object_list:
            if ((not face.person) or inferred) and face.encoding:
                face_encoding.append(face.get_encoding_array())

    # Perform PCA for dimensionality reduction
    pca = PCA(n_components=3)
    vis_all = pca.fit_transform(face_encoding)

    res = []
    for face, vis in zip(faces, vis_all):
        person_id = face.person.id if face.person else UNKNOWN_CLUSTER_ID
        person_name = face.person.name if face.person else "unknown"

        # Ensure UNKNOWN_CLUSTER_ID is in p2c
        if person_id not in p2c:
            # Assign a default color if not found
            color = "#000000"  # Default to black or any fallback color
        else:
            color = p2c[person_id]

        res.append(
            {
                "person_id": person_id,
                "person_name": person_name,
                "person_label_is_inferred": not face.person,
                "color": color,
                "face_url": face.image.url,
                "value": {"x": vis[0], "y": vis[1], "size": vis[2]},
            }
        )
    return res


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
    lrj.progress_target = 1
    lrj.save()

    try:
        delete_clustered_people(user)
        delete_clusters(user)
        delete_persons_without_faces()
        target_count: int = create_all_clusters(user, lrj)

        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.progress_current = target_count
        lrj.progress_target = target_count
        lrj.save()

        train_job_id = uuid.uuid4()
        AsyncTask(train_faces, user, train_job_id).run()
        return True

    except BaseException as err:
        logger.exception("An error occurred")
        print(f"[ERR] {err}")
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
    logger.info("Creating clusters")

    data = {
        "all": {"encoding": [], "id": [], "person_id": [], "person_labeled": []},
    }
    for face in Face.objects.filter(photo__owner=user).prefetch_related("person"):
        data["all"]["encoding"].append(face.get_encoding_array())
        data["all"]["id"].append(face.id)

    target_count = len(data["all"]["id"])
    if target_count == 0:
        return target_count

    min_cluster_size = 2
    # double cluster size for every 10x increase in target counts, if user has not set a valid min_cluster_size
    if (
        user.min_cluster_size == 0
        or user.min_cluster_size is None
        or user.min_cluster_size == 1
    ):
        if target_count > 1000:
            min_cluster_size = 4
        if target_count > 10000:
            min_cluster_size = 8
        if target_count > 100000:
            min_cluster_size = 16
    else:
        min_cluster_size = user.min_cluster_size

    min_samples = 1
    if user.min_samples > 0:
        min_samples = user.min_samples

    # creating HDBSCAN object for clustering the encodings with the metric "euclidean"
    clt = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        cluster_selection_epsilon=user.cluster_selection_epsilon,
        metric="euclidean",
    )
    logger.info("Before finding clusters")
    # clustering the encodings
    clt.fit(np.array(data["all"]["encoding"]))
    logger.info("After finding clusters")

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

    logger.info(f"Found {len(sortedIndexes)} clusters")
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
        face_array = Face.objects.filter(
            Q(pk__in=face_id_list) & Q(encoding__isnull=False) & Q(deleted=False)
        )
        new_clusters: list[Cluster] = ClusterManager.try_add_cluster(
            user, clusterId, face_array, maxLen
        )

        if commit_time < datetime.datetime.now() and lrj is not None:
            lrj.progress_current = count
            lrj.progress_target = target_count
            lrj.save()
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)

        all_clusters.extend(new_clusters)

    print(f"[INFO] Created {len(all_clusters)} clusters")
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
    Person.objects.filter(kind=Person.KIND_UNKNOWN, cluster_owner=user).delete()
    Person.objects.filter(cluster_owner=None).delete()
    Person.objects.filter(cluster_owner=get_deleted_user()).delete()


# Function to filter data based on a desired shape
def filter_data(encodings, ids):
    valid_encodings = []
    valid_ids = []
    expected_shape = (
        len(encodings[0]) if encodings else 0
    )  # Set expected shape from first entry

    for i, (encoding, id_) in enumerate(zip(encodings, ids)):
        if len(encoding) == expected_shape:  # Check if shape is consistent
            valid_encodings.append(encoding)
            valid_ids.append(id_)
        else:
            logger.error(
                f"Discarding entry {i}: ID={id_}, encoding shape={len(encoding)} (expected {expected_shape})"
            )

    return np.array(valid_encodings), np.array(valid_ids)


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
    lrj.progress_current = 1
    lrj.progress_target = 2
    lrj.save()
    try:
        # Use two array, so that the first one gets thrown out, if it is no longer used.
        data_known = {"encoding": [], "id": []}
        data_unknown = {"encoding": [], "id": []}
        # First, sort all faces into known and unknown ones
        face: Face
        for face in Face.objects.filter(
            Q(photo__owner=user) & Q(encoding__isnull=False) & Q(deleted=False)
        ).prefetch_related("person"):
            if not face.person:
                data_unknown["encoding"].append(face.get_encoding_array())
                data_unknown["id"].append(face.id)
            else:
                data_known["encoding"].append(face.get_encoding_array())
                data_known["id"].append(face.person.id)

        if len(data_known["id"]) == 0:
            classifier = None
        else:
            logger.info("Before fitting")
            classifier = MLPClassifier(
                solver="adam", alpha=1e-5, random_state=1, max_iter=1000
            ).fit(np.array(data_known["encoding"]), np.array(data_known["id"]))
            logger.info("After fitting")

        # Next, pretend all unknown face clusters are known and add their mean encoding. This allows us
        # to predict the likelihood of other unknown faces belonging to those simulated clusters. For
        # the "Unknown - Other"-type cluster, we can still try to predict the probability that the face
        # can't be classified into another group, i.e. that it should be classified that way
        cluster: Cluster
        for cluster in Cluster.objects.filter(owner=user):
            if cluster.person and cluster.person.kind == Person.KIND_CLUSTER:
                print(cluster.person)
                data_known["encoding"].append(cluster.get_mean_encoding_array())
                data_known["id"].append(cluster.person.id)

        filtered_encodings, filtered_ids = filter_data(
            data_known["encoding"], data_known["id"]
        )

        # Fit the classifier based on the "known" faces, including the simulated clusters
        logger.info("Before cluster fitting")
        cluster_classifier = MLPClassifier(
            solver="adam", alpha=1e-5, random_state=1, max_iter=1000
        ).fit(filtered_encodings, filtered_ids)
        logger.info("After cluster fitting")

        # Collect the probabilities for each unknown face. The probabilities returned
        # are arrays in the same order as the people IDs in the original training set
        target_count = len(data_unknown["id"])
        if target_count == 0:
            logger.info("No clusters found")
            lrj.finished = True
            lrj.failed = False
            lrj.progress_current = 2
            lrj.progress_target = 2
            lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
            return True
        logger.info(f"Number of Cluster: {target_count}")

        # Hacky way to split arrays into smaller arrays
        pages_encoding = [
            data_unknown["encoding"][i : i + 100]
            for i in range(0, len(data_unknown["encoding"]), 100)
        ]
        pages_id = [
            data_unknown["id"][i : i + 100]
            for i in range(0, len(data_unknown["encoding"]), 100)
        ]
        for idx, page in enumerate(pages_encoding):
            page_id = pages_id[idx]
            pages_of_faces = Face.objects.filter(id__in=page_id).all()
            # sort pages of faces by id by page_id
            pages_of_faces = sorted(pages_of_faces, key=lambda x: page_id.index(x.id))
            face_encodings_unknown_np = np.array(page)
            cluster_probs = cluster_classifier.predict_proba(face_encodings_unknown_np)
            if classifier:
                classification_probs = classifier.predict_proba(
                    face_encodings_unknown_np
                )
            else:
                classification_probs = []
                while len(classification_probs) < len(cluster_probs):
                    classification_probs.append(
                        [0.0] * len(cluster_classifier.classes_)
                    )

            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
            face_stack = []
            unknown_cluster: Cluster = get_unknown_cluster(user=user)

            for idx, (
                face,
                cluster_probabilities,
                classification_probabilties,
            ) in enumerate(zip(pages_of_faces, cluster_probs, classification_probs)):
                face.cluster_probability = 0.0  # Cluster probability
                face.classification_probability = 0.0  # Classification probability
                classification_person = None
                classification_probability = 0.0

                highest_classification_probability = max(classification_probabilties)
                highest_classification_person = 0

                # Find the person with the highest probability for classification
                if classifier:
                    for i, target in enumerate(classifier.classes_):
                        if (
                            highest_classification_probability
                            == classification_probabilties[i]
                        ):
                            highest_classification_person = target

                    classification_person = highest_classification_person
                    classification_probability = highest_classification_probability

                # Find the probability in the probability array corresponding to the person
                # that we currently believe the face is, even a simulated "unknown" person
                highest_probability = max(cluster_probabilities)
                highest_probability_person = 0
                for i, target in enumerate(cluster_classifier.classes_):
                    if highest_probability == cluster_probabilities[i]:
                        highest_probability_person = target

                if face.cluster != unknown_cluster:
                    face.cluster_person = Person.objects.get(
                        id=highest_probability_person
                    )
                    face.cluster_probability = highest_probability

                if classification_person:
                    face.classification_person = Person.objects.get(
                        id=classification_person
                    )
                    face.classification_probability = classification_probability

                face_stack.append(face)
                if commit_time < datetime.datetime.now():
                    lrj.progress_current = idx + 1
                    lrj.progress_target = target_count
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
        lrj.progress_current = target_count
        lrj.progress_target = target_count
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return True

    except BaseException as err:
        logger.exception("An error occurred")
        print(f"[ERR] {err}")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        return False
