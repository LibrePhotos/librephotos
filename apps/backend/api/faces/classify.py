from __future__ import annotations

import datetime
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, TypedDict

from bulk_update.helper import bulk_update
from django.conf import settings
from django.core.paginator import Paginator
from django.db.models import Q

from api.dataviz.color_palettes import hex_palette
from api.faces.cluster_manager import ClusterManager
from api.jobs.queue import enqueue_followup
from api.lazy_import import LazyModule
from api.models import Face, LongRunningJob, Person
from api.models.cluster import UNKNOWN_CLUSTER_ID, Cluster, get_unknown_cluster
from api.models.user import User, get_deleted_user

if TYPE_CHECKING:
    import numpy.typing as npt
    from hdbscan import HDBSCAN as _HDBSCAN
    from numpy import float64, intp
    from sklearn.decomposition import PCA as _PCA
    from sklearn.neural_network import MLPClassifier as _MLPClassifier

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)


class _FaceData(TypedDict):
    """Encodings and their ids: a face id, or the id of the person it is labelled with."""

    encoding: list[npt.NDArray[float64]]
    id: list[int]


# hdbscan and scikit-learn (with scipy) take 1.6 s and ~100 MB to import, and
# this module is imported by the API server, which never clusters. They load
# on first use; the factories are module attributes so tests can patch them.
def make_pca(*args: Any, **kwargs: Any) -> _PCA:
    from sklearn.decomposition import PCA

    return PCA(*args, **kwargs)


def make_hdbscan(*args: Any, **kwargs: Any) -> _HDBSCAN:
    from hdbscan import HDBSCAN

    return HDBSCAN(*args, **kwargs)


def make_mlp_classifier(*args: Any, **kwargs: Any) -> _MLPClassifier:
    from sklearn.neural_network import MLPClassifier

    return MLPClassifier(*args, **kwargs)


FACE_CLASSIFY_COLUMNS = [
    "person",
    "classification_person",
    "classification_probability",
    "cluster_person",
    "cluster_probability",
    "id",
    "cluster",
]


def build_person_color_map(user: User) -> dict[int, str]:
    """Map each person appearing in the user's faces to a palette color"""
    persons = [p.id for p in Person.objects.filter(faces__photo__owner=user).distinct()]
    return dict(zip(persons, hex_palette(n_colors=len(persons))))


def collect_visualizable_faces(
    user: User, inferred: bool
) -> tuple[list[npt.NDArray[float64]], list[Face]]:
    """The user's non-deleted faces that carry an encoding, paired with those
    encodings. Labeled faces are only included when inferred ones are wanted."""
    face_encoding = []
    faces_with_encoding = []
    faces = Face.objects.filter(Q(photo__owner=user) & Q(deleted=False))
    paginator = Paginator(faces, 5000)

    for page in range(1, paginator.num_pages + 1):
        for face in paginator.page(page).object_list:
            if ((not face.person) or inferred) and face.encoding:
                face_encoding.append(face.get_encoding_array())
                faces_with_encoding.append(face)

    return face_encoding, faces_with_encoding


def build_scatter_point(
    face: Face, vis: npt.NDArray[float64], p2c: dict[int, str]
) -> dict[str, object]:
    person = face.person
    person_id = person.id if person else UNKNOWN_CLUSTER_ID
    return {
        "person_id": person_id,
        "person_name": person.name if person else "unknown",
        "person_label_is_inferred": not person,
        "color": p2c.get(person_id, "#000000"),
        "face_url": face.image.url,
        "value": {"x": vis[0], "y": vis[1], "size": vis[2]},
    }


def cluster_faces(user: User, inferred: bool = True) -> dict[str, object]:
    p2c = build_person_color_map(user)
    face_encoding, faces_with_encoding = collect_visualizable_faces(user, inferred)

    if len(face_encoding) == 0:
        return {"status": True, "data": []}

    pca = make_pca(n_components=3)
    vis_all = pca.fit_transform(face_encoding)

    res = [
        build_scatter_point(face, vis, p2c)
        for face, vis in zip(faces_with_encoding, vis_all)
    ]
    return {"status": True, "data": res}


def cluster_all_faces(user: User, job_id: uuid.UUID | str | None = None) -> bool:
    """Groups all faces into clusters for ease of labeling. It first deletes all
    existing clusters, then regenerates them all. It will split clusters that have
    more than one kind of labeled face.
    :param user: the current user running the training
    :param job_id: the background job ID; None when ``scan_faces`` calls it
    """
    if not settings.FEATURE_FACE_CLUSTER:
        logger.info("Face clustering is disabled")
        LongRunningJob.complete_unclaimed(job_id)
        return False

    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id)
    if lrj is None:
        return False
    lrj.update_progress(current=0, target=1)

    try:
        delete_clustered_people(user)
        delete_clusters(user)
        delete_persons_without_faces()
        target_count: int = create_all_clusters(user, lrj)

        lrj.update_progress(current=target_count, target=target_count)
        if not lrj.complete():
            logger.info("Face clustering job %s was cancelled", lrj.job_id)
            return False

        enqueue_followup(user, LongRunningJob.JOB_TRAIN_FACES, train_faces, user)
        return True

    except Exception as err:
        logger.exception("Face clustering job %s failed", lrj.job_id)
        lrj.fail(error=err)
        return False


def collect_face_encodings(user: User) -> dict:
    """Gather every usable encoding of the user's faces, keyed alongside its face id"""
    encodings: list = []
    ids: list[int] = []
    encoding_length: int | None = None
    face: Face
    for face in Face.objects.filter(
        photo__owner=user, encoding__isnull=False
    ).prefetch_related("person"):
        if not face.encoding:
            continue
        enc = face.get_encoding_array()
        if encoding_length is None:
            encoding_length = len(enc)
        elif len(enc) != encoding_length:
            logger.warning(
                "Skipping face %d: encoding length %d does not match expected %d "
                "(face recognition model may have changed)",
                face.id,
                len(enc),
                encoding_length,
            )
            continue
        encodings.append(enc)
        ids.append(face.id)
    return {"encoding": encodings, "id": ids}


def resolve_min_cluster_size(user: User, target_count: int) -> int:
    """Double the cluster size for every 10x increase in target counts, unless the
    user has set a valid min_cluster_size"""
    if user.min_cluster_size not in (0, 1, None):
        return user.min_cluster_size
    if target_count > 100000:
        return 16
    if target_count > 10000:
        return 8
    if target_count > 1000:
        return 4
    return 2


def build_clusterer(user: User, target_count: int) -> _HDBSCAN:
    return make_hdbscan(
        min_cluster_size=resolve_min_cluster_size(user, target_count),
        min_samples=user.min_samples if user.min_samples > 0 else 1,
        cluster_selection_epsilon=user.cluster_selection_epsilon,
        metric="euclidean",
    )


def group_indexes_by_label(
    labels: npt.NDArray[intp],
) -> dict[int, npt.NDArray[intp]]:
    return {label: np.where(labels == label)[0] for label in np.unique(labels)}


def create_all_clusters(user: User, lrj: LongRunningJob | None = None) -> int:
    """Generate Cluster records for each different clustering of people
    :param user: the current user
    :param lrj: LongRunningJob to update, if needed
    """
    logger.info("Creating clusters")
    data = collect_face_encodings(user)

    target_count = len(data["id"])
    if target_count == 0:
        return target_count

    clt = build_clusterer(user, target_count)
    logger.info("Before finding clusters")
    clt.fit(np.array(data["encoding"]))
    logger.info("After finding clusters")

    sorted_indexes = group_indexes_by_label(clt.labels_)
    max_len: int = len(str(len(sorted_indexes)))
    all_clusters: list[Cluster] = []
    commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
    count: int = 0
    cluster_count: int = 0

    logger.info("Found %s clusters", len(sorted_indexes))
    for label_id in sorted(
        sorted_indexes, key=lambda key: np.size(sorted_indexes[key]), reverse=True
    ):
        if label_id != UNKNOWN_CLUSTER_ID:
            cluster_count = cluster_count + 1
            cluster_id = cluster_count
        else:
            cluster_id = label_id
        face_id_list = [data["id"][i] for i in sorted_indexes[label_id]]
        count = count + len(face_id_list)
        face_array = list(
            Face.objects.filter(
                Q(pk__in=face_id_list) & Q(encoding__isnull=False) & Q(deleted=False)
            )
        )
        all_clusters.extend(
            ClusterManager.try_add_cluster(user, cluster_id, face_array, max_len)
        )

        if commit_time < datetime.datetime.now() and lrj is not None:
            lrj.update_progress(current=count, target=target_count)
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)

    logger.info("Created %s clusters", len(all_clusters))
    return target_count


def delete_persons_without_faces() -> None:
    """Delete all existing Person records that have no associated Face records"""
    logger.info("Deleting all people without faces")
    Person.objects.filter(faces=None, kind=Person.KIND_USER).delete()


def delete_clusters(user: User) -> None:
    """Delete all existing Cluster records"""
    logger.info("Deleting all clusters")
    Cluster.objects.filter(Q(owner=user)).delete()
    Cluster.objects.filter(Q(owner=None)).delete()
    Cluster.objects.filter(Q(owner=get_deleted_user())).delete()


def delete_clustered_people(user: User) -> None:
    """Delete all existing Person records of type CLUSTER"""
    logger.info("Deleting all clustered people")
    Person.objects.filter(kind=Person.KIND_CLUSTER, cluster_owner=user).delete()
    Person.objects.filter(kind=Person.KIND_UNKNOWN, cluster_owner=user).delete()
    Person.objects.filter(cluster_owner=None).delete()
    Person.objects.filter(cluster_owner=get_deleted_user()).delete()


# Function to filter data based on a desired shape
def filter_data(
    encodings: list[npt.NDArray[float64]], ids: list[int]
) -> tuple[npt.NDArray[float64], npt.NDArray[intp]]:
    valid_encodings: list[npt.NDArray[float64]] = []
    valid_ids: list[int] = []
    expected_shape = (
        len(encodings[0]) if encodings else 0
    )  # Set expected shape from first entry

    for i, (encoding, id_) in enumerate(zip(encodings, ids)):
        if len(encoding) == expected_shape:  # Check if shape is consistent
            valid_encodings.append(encoding)
            valid_ids.append(id_)
        else:
            logger.error(
                "Discarding entry %s: ID=%s, encoding shape=%s (expected %s)",
                i,
                id_,
                len(encoding),
                expected_shape,
            )

    return np.array(valid_encodings), np.array(valid_ids)


def fit_mlp(encodings: npt.NDArray[float64], ids: npt.NDArray[intp]) -> _MLPClassifier:
    return make_mlp_classifier(
        solver="adam", alpha=1e-5, random_state=1, max_iter=1000
    ).fit(encodings, ids)


def split_faces_by_label(user: User) -> tuple[_FaceData, _FaceData]:
    """Sort the user's faces into person-labeled ones and unlabeled ones. Two dicts,
    so that the known one can be thrown out once it is no longer used."""
    data_known: _FaceData = {"encoding": [], "id": []}
    data_unknown: _FaceData = {"encoding": [], "id": []}
    face: Face
    for face in Face.objects.filter(
        Q(photo__owner=user)
        & Q(encoding__isnull=False)
        & ~Q(encoding="")
        & Q(deleted=False)
    ).prefetch_related("person"):
        if not face.person:
            data_unknown["encoding"].append(face.get_encoding_array())
            data_unknown["id"].append(face.id)
        else:
            data_known["encoding"].append(face.get_encoding_array())
            data_known["id"].append(face.person.id)
    return data_known, data_unknown


def add_cluster_centroids(user: User, data_known: _FaceData) -> None:
    """Pretend all unknown face clusters are known and add their mean encoding. This
    allows us to predict the likelihood of other unknown faces belonging to those
    simulated clusters. For the "Unknown - Other"-type cluster, we can still try to
    predict the probability that the face can't be classified into another group,
    i.e. that it should be classified that way"""
    cluster: Cluster
    for cluster in Cluster.objects.filter(owner=user):
        if cluster.person and cluster.person.kind == Person.KIND_CLUSTER:
            logger.debug("Adding the centroid of person %s", cluster.person.id)
            data_known["encoding"].append(cluster.get_mean_encoding_array())
            data_known["id"].append(cluster.person.id)


def most_probable_class(
    classes: Sequence[int], probabilities: Sequence[float] | npt.NDArray[float64]
) -> tuple[int, float]:
    """The last class whose probability equals the highest one, and that probability"""
    highest_probability = max(probabilities)
    highest_class = 0
    for i, target in enumerate(classes):
        if highest_probability == probabilities[i]:
            highest_class = target
    return highest_class, highest_probability


@dataclass
class _Classifiers:
    """What ``train_faces`` predicts the person of an unlabelled face with."""

    # Trained on the labelled faces; None when there are none.
    person: _MLPClassifier | None
    # Trained on the labelled faces and the centroids of the clusters.
    cluster: _MLPClassifier
    # A face in this cluster gets no cluster person.
    unknown_cluster: Cluster


def assign_face_predictions(
    face: Face,
    cluster_probabilities: Sequence[float] | npt.NDArray[float64],
    classification_probabilities: Sequence[float] | npt.NDArray[float64],
    classifiers: _Classifiers,
) -> None:
    face.cluster_probability = 0.0
    face.classification_probability = 0.0

    classification_person = None
    classification_probability = 0.0
    if classifiers.person:
        classification_person, classification_probability = most_probable_class(
            classifiers.person.classes_, classification_probabilities
        )

    # Find the probability in the probability array corresponding to the person
    # that we currently believe the face is, even a simulated "unknown" person
    highest_probability_person, highest_probability = most_probable_class(
        classifiers.cluster.classes_, cluster_probabilities
    )

    if face.cluster != classifiers.unknown_cluster:
        face.cluster_person = Person.objects.get(id=highest_probability_person)
        face.cluster_probability = highest_probability

    if classification_person:
        face.classification_person = Person.objects.get(id=classification_person)
        face.classification_probability = classification_probability


def classify_face_page(
    classifiers: _Classifiers,
    page_encodings: list[npt.NDArray[float64]],
    page_id: list[int],
    lrj: LongRunningJob,
    target_count: int,
) -> None:
    pages_of_faces: list[Face] = sorted(
        Face.objects.filter(id__in=page_id).all(), key=lambda x: page_id.index(x.id)
    )
    face_encodings_unknown_np = np.array(page_encodings)
    cluster_probs = classifiers.cluster.predict_proba(face_encodings_unknown_np)
    if classifiers.person:
        classification_probs = classifiers.person.predict_proba(
            face_encodings_unknown_np
        )
    else:
        classification_probs = [
            [0.0] * len(classifiers.cluster.classes_) for _ in cluster_probs
        ]

    commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
    face_stack = []

    for idx, (face, cluster_probabilities, classification_probabilities) in enumerate(
        zip(pages_of_faces, cluster_probs, classification_probs)
    ):
        assign_face_predictions(
            face,
            cluster_probabilities,
            classification_probabilities,
            classifiers,
        )
        face_stack.append(face)
        if commit_time < datetime.datetime.now():
            lrj.update_progress(current=idx + 1, target=target_count)
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
        if len(face_stack) > 200:
            bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
            face_stack = []

    bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)


def train_faces(user: User, job_id: uuid.UUID | str) -> bool:
    """Given existing Cluster records for all faces, determines the probability
    that unknown faces belong to those Clusters. It takes any known, labeled faces
    and adds the centroids of "unknown" clusters, assuming that those clusters
    correspond to *some* face. It then trains a classifier on that data to use
    in calculating the probabilities for unknown faces.
    :param user: the current user running the training
    :param job_id: the background job ID
    """
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_TRAIN_FACES, job_id)
    if lrj is None:
        return False
    lrj.update_progress(current=1, target=2)
    try:
        data_known, data_unknown = split_faces_by_label(user)

        if len(data_known["id"]) == 0:
            classifier = None
        else:
            logger.info("Before fitting")
            classifier = fit_mlp(
                np.array(data_known["encoding"]), np.array(data_known["id"])
            )
            logger.info("After fitting")

        add_cluster_centroids(user, data_known)
        filtered_encodings, filtered_ids = filter_data(
            data_known["encoding"], data_known["id"]
        )

        # Fit the classifier based on the "known" faces, including the simulated clusters
        logger.info("Before cluster fitting")
        cluster_classifier = fit_mlp(filtered_encodings, filtered_ids)
        logger.info("After cluster fitting")

        # Collect the probabilities for each unknown face. The probabilities returned
        # are arrays in the same order as the people IDs in the original training set
        if data_unknown["encoding"]:
            filtered_unknown_encodings, filtered_unknown_ids = filter_data(
                data_unknown["encoding"], data_unknown["id"]
            )
            data_unknown["encoding"] = list(filtered_unknown_encodings)
            data_unknown["id"] = [int(face_id) for face_id in filtered_unknown_ids]

        target_count = len(data_unknown["id"])
        if target_count == 0:
            logger.info("No clusters found")
            lrj.update_progress(current=2, target=2)
            lrj.complete()
            return True
        logger.info("Number of Cluster: %s", target_count)

        classifiers = _Classifiers(
            person=classifier,
            cluster=cluster_classifier,
            unknown_cluster=get_unknown_cluster(user=user),
        )
        for start in range(0, len(data_unknown["encoding"]), 100):
            classify_face_page(
                classifiers,
                data_unknown["encoding"][start : start + 100],
                data_unknown["id"][start : start + 100],
                lrj,
                target_count,
            )

        lrj.update_progress(current=target_count, target=target_count)
        lrj.complete()
        return True

    except Exception as err:
        logger.exception("Face training job %s failed", lrj.job_id)
        lrj.fail(error=err)
        return False
