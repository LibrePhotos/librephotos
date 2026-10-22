from __future__ import annotations

import datetime
import logging
import uuid
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypedDict

from bulk_update.helper import bulk_update
from django.core.paginator import Paginator
from django.db.models import Q

from api.dataviz.color_palettes import hex_palette
from api.faces.birth_dates import (
    birth_dates_of,
    photo_dates_of_faces,
    unborn_people,
    without_unborn,
)
from api.faces.cluster_manager import ClusterManager
from api.faces.clustering_gate import latest_face_id, record_clustering
from api.jobs.queue import enqueue_followup
from api.lazy_import import LazyModule
from api.models import Face, LongRunningJob, Person
from api.models.cluster import UNKNOWN_CLUSTER_ID, Cluster, get_unknown_cluster
from api.models.long_running_job import JobCancelledError
from api.models.user import User
from api.runtime.features import feature_enabled

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


# What training writes back: only its predictions. The label (``person``)
# and the cluster belong to the user and to clustering, and either can change
# while training runs; writing the loaded values back would undo that.
FACE_PREDICTION_COLUMNS = [
    "classification_person",
    "classification_probability",
    "cluster_person",
    "cluster_probability",
]


def build_person_color_map(user: User) -> dict[int, str]:
    """Map each person appearing in the user's faces to a palette color"""
    persons = list(
        Person.objects.filter(Face.objects.owner_q(user, through="faces__"))
        .values_list("id", flat=True)
        .distinct()
    )
    return dict(zip(persons, hex_palette(n_colors=len(persons))))


def collect_visualizable_faces(
    user: User, inferred: bool
) -> tuple[list[npt.NDArray[float64]], list[Face]]:
    """The user's non-deleted faces that carry an encoding and a crop, paired
    with those encodings. Labeled faces are only included when inferred ones are
    wanted. A face without a crop (legacy rows) has nothing to show on the chart."""
    face_encoding = []
    faces_with_encoding = []
    faces = Face.objects.owned_by(user).on_shown_photos().filter(deleted=False)
    paginator = Paginator(faces, 5000)

    for page in range(1, paginator.num_pages + 1):
        for face in paginator.page(page).object_list:
            if ((not face.person) or inferred) and face.encoding and face.image:
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
    more than one kind of labeled face. Every clustering, whoever started it,
    moves the user's face watermark (``record_clustering``), so the upload
    follow-ups do not cluster the same faces again.
    :param user: the current user running the training
    :param job_id: the background job ID; None when ``scan_faces`` calls it
    """
    if not feature_enabled("FACE_CLUSTER"):
        logger.info("Face clustering is disabled")
        LongRunningJob.complete_unclaimed(job_id)
        return False

    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id)
    if lrj is None:
        return False
    lrj.update_progress(current=0, target=1)

    try:
        # The clusters are deleted and then built again, so a cancel is only
        # honoured before the deletes: stopping in between would leave the
        # user without clusters. A cancel during the rebuild still skips the
        # training follow-up (complete() below).
        lrj.stop_if_cancelled()
        # Taken before the rebuild: a face added while it runs is not in it,
        # so the upload follow-ups count it as new (#2738).
        watermark = latest_face_id(user)
        delete_clustered_people(user)
        delete_clusters(user)
        delete_persons_without_faces(user)
        target_count: int = create_all_clusters(user, lrj)
        record_clustering(user, watermark)

        lrj.update_progress(current=target_count, target=target_count)
        if not lrj.complete():
            logger.info("Face clustering job %s was cancelled", lrj.job_id)
            return False

        enqueue_followup(user, LongRunningJob.JOB_TRAIN_FACES, train_faces, user)
        return True

    except JobCancelledError:
        logger.info("Face clustering job %s was cancelled", lrj.job_id)
        return False
    except Exception as err:
        logger.exception("Face clustering job %s failed", lrj.job_id)
        lrj.fail(error=err)
        return False


def collect_face_encodings(user: User) -> _FaceData:
    """The encoding of every face of the user's that clustering learns from
    (``FaceQuerySet.for_recognition``), alongside its face id"""
    encodings: list[npt.NDArray[float64]] = []
    ids: list[int] = []
    encoding_length: int | None = None
    face: Face
    for face in Face.objects.owned_by(user).for_recognition():
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


# Clustering one user rebuilds only that user's rows: each delete below is
# scoped to ``user``, so another user's people and clusters, even a person
# just created with no faces yet, survive it (#2732).


def delete_persons_without_faces(user: User) -> None:
    """Delete the user's named people that have no face left"""
    logger.info("Deleting the people without faces of user %s", user.id)
    Person.objects.owned_by(user).filter(faces=None, kind=Person.KIND_USER).delete()


def delete_clusters(user: User) -> None:
    """Delete the user's clusters"""
    logger.info("Deleting the clusters of user %s", user.id)
    Cluster.objects.owned_by(user).delete()


def delete_clustered_people(user: User) -> None:
    """Delete the user's cluster people ("Unknown NNN" and "Unknown - Other")"""
    logger.info("Deleting the clustered people of user %s", user.id)
    Person.objects.owned_by(user).filter(
        kind__in=(Person.KIND_CLUSTER, Person.KIND_UNKNOWN)
    ).delete()


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


def classifier_input(
    encodings: npt.ArrayLike,
) -> npt.NDArray[float64]:
    """Unit-length encodings scaled by the square root of their length, so each
    number spreads about as much as 1. The classifier is as accurate on plain
    unit-length encodings but needs about three times the iterations."""
    array = np.asarray(encodings, dtype=np.float64)
    if array.ndim != 2:
        return array
    return array * np.sqrt(array.shape[1])


def fit_mlp(encodings: npt.NDArray[float64], ids: npt.NDArray[intp]) -> _MLPClassifier:
    return make_mlp_classifier(
        solver="adam", alpha=1e-5, random_state=1, max_iter=1000
    ).fit(classifier_input(encodings), ids)


def split_faces_by_label(user: User) -> tuple[_FaceData, _FaceData]:
    """Sort the user's faces that training learns from
    (``FaceQuerySet.for_recognition``) into person-labeled ones, keyed by their
    person, and unlabeled ones, keyed by their face. Two dicts, so that the known
    one can be thrown out once it is no longer used."""
    data_known: _FaceData = {"encoding": [], "id": []}
    data_unknown: _FaceData = {"encoding": [], "id": []}
    face: Face
    for face in Face.objects.owned_by(user).for_recognition():
        if face.person_id is None:
            data_unknown["encoding"].append(face.get_encoding_array())
            data_unknown["id"].append(face.id)
        else:
            data_known["encoding"].append(face.get_encoding_array())
            data_known["id"].append(face.person_id)
    return data_known, data_unknown


def add_cluster_centroids(user: User, data_known: _FaceData) -> None:
    """Pretend all unknown face clusters are known and add their mean encoding. This
    allows us to predict the likelihood of other unknown faces belonging to those
    simulated clusters. For the "Unknown - Other"-type cluster, we can still try to
    predict the probability that the face can't be classified into another group,
    i.e. that it should be classified that way"""
    cluster: Cluster
    for cluster in Cluster.objects.owned_by(user).select_related("person"):
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


def likeliest_class(
    classes: Sequence[int], probabilities: Sequence[float] | npt.NDArray[float64]
) -> tuple[int | None, float]:
    """``most_probable_class``, or None when no class has a chance: every one
    was ruled out (people born after the photo, #2752), so no suggestion."""
    person_id, probability = most_probable_class(classes, probabilities)
    if probability <= 0:
        return None, 0.0
    return person_id, probability


def rejected_people_of(face_ids: Iterable[int]) -> dict[int, set[int]]:
    """The people each face was rejected for ("Not Anna", #2747), by face id"""
    rejected: dict[int, set[int]] = defaultdict(set)
    for face_id, person_id in Face.rejected_persons.through.objects.filter(
        face_id__in=face_ids
    ).values_list("face_id", "person_id"):
        rejected[face_id].add(person_id)
    return rejected


@dataclass
class _Classifiers:
    """What ``train_faces`` predicts the person of an unlabelled face with."""

    # Trained on the labelled faces; None when there are none.
    person: _MLPClassifier | None
    # Trained on the labelled faces and the centroids of the clusters.
    cluster: _MLPClassifier
    # A face in this cluster gets no cluster person.
    unknown_cluster: Cluster
    # The birth dates of the user's people that have one (#2752).
    birth_dates: Mapping[int, datetime.date] = field(default_factory=dict)

    def predicted_persons(self) -> dict[int, Person]:
        """The people the classifiers can predict that still exist, by id.

        A recluster running meanwhile deletes the cluster people, and the user
        can delete a person: a prediction of one of them is left empty.
        """
        classes = {int(class_id) for class_id in self.cluster.classes_}
        if self.person is not None:
            classes.update(int(class_id) for class_id in self.person.classes_)
        return Person.objects.in_bulk(classes)

    def born_only(
        self,
        unborn: Collection[int],
        cluster_probabilities: Sequence[float] | npt.NDArray[float64],
        classification_probabilities: Sequence[float] | npt.NDArray[float64],
    ) -> tuple[
        Sequence[float] | npt.NDArray[float64], Sequence[float] | npt.NDArray[float64]
    ]:
        """Both rows of probabilities with the ``unborn`` people at 0 (#2752).

        Any person ruled out for the face goes here too: the people the user
        said it is not (#2747) are passed along with the unborn ones.
        """
        if not unborn:
            return cluster_probabilities, classification_probabilities
        if self.person is not None:
            classification_probabilities = without_unborn(
                self.person.classes_, classification_probabilities, unborn
            )
        return (
            without_unborn(self.cluster.classes_, cluster_probabilities, unborn),
            classification_probabilities,
        )


def existing_prediction(
    persons: Mapping[int, Person], person_id: int | None, probability: float
) -> tuple[Person | None, float]:
    """``person_id`` with its probability, or no one when that person is gone
    or there is no prediction"""
    person = None if person_id is None else persons.get(int(person_id))
    if person is None:
        return None, 0.0
    return person, probability


def assign_face_predictions(
    face: Face,
    cluster_probabilities: Sequence[float] | npt.NDArray[float64],
    classification_probabilities: Sequence[float] | npt.NDArray[float64],
    classifiers: _Classifiers,
    persons: Mapping[int, Person],
) -> None:
    face.cluster_probability = 0.0
    face.classification_probability = 0.0

    # Find the probability in the probability array corresponding to the person
    # that we currently believe the face is, even a simulated "unknown" person
    if face.cluster_id != classifiers.unknown_cluster.id:
        face.cluster_person, face.cluster_probability = existing_prediction(
            persons,
            *likeliest_class(classifiers.cluster.classes_, cluster_probabilities),
        )

    if classifiers.person:
        classification_person, classification_probability = likeliest_class(
            classifiers.person.classes_, classification_probabilities
        )
        if classification_person is None:
            face.classification_person = None
        elif classification_person:
            face.classification_person, face.classification_probability = (
                existing_prediction(
                    persons, classification_person, classification_probability
                )
            )


def classify_face_page(
    classifiers: _Classifiers,
    page_encodings: list[npt.NDArray[float64]],
    page_id: list[int],
    lrj: LongRunningJob,
    target_count: int,
) -> None:
    # By id, so a face deleted meanwhile is skipped instead of shifting the
    # predictions of the faces after it onto the wrong face.
    faces_by_id = Face.objects.in_bulk(page_id)
    persons = classifiers.predicted_persons()
    taken_by_face = photo_dates_of_faces(page_id) if classifiers.birth_dates else {}
    rejected = rejected_people_of(page_id)
    face_encodings_unknown_np = classifier_input(page_encodings)
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

    for idx, (
        face_id,
        cluster_probabilities,
        classification_probabilities,
    ) in enumerate(zip(page_id, cluster_probs, classification_probs)):
        face = faces_by_id.get(face_id)
        if face is None:
            continue
        # Never a person born after the photo was taken (#2752)
        unborn = unborn_people(classifiers.birth_dates, taken_by_face.get(face_id))
        # Nor one the user said the face is not ("Not Anna", #2747)
        ruled_out = unborn | rejected.get(face_id, set())
        assign_face_predictions(
            face,
            *classifiers.born_only(
                ruled_out, cluster_probabilities, classification_probabilities
            ),
            classifiers,
            persons,
        )
        face_stack.append(face)
        if commit_time < datetime.datetime.now():
            lrj.update_progress(current=idx + 1, target=target_count)
            commit_time = datetime.datetime.now() + datetime.timedelta(seconds=5)
        if len(face_stack) > 200:
            bulk_update(face_stack, update_fields=FACE_PREDICTION_COLUMNS)
            face_stack = []

    bulk_update(face_stack, update_fields=FACE_PREDICTION_COLUMNS)


def fit_person_classifier(data_known: _FaceData) -> _MLPClassifier | None:
    """The classifier of the labelled faces; None when no face is labelled"""
    if not data_known["id"]:
        return None
    logger.info("Before fitting")
    classifier = fit_mlp(np.array(data_known["encoding"]), np.array(data_known["id"]))
    logger.info("After fitting")
    return classifier


def finish_without_predictions(
    lrj: LongRunningJob, result: dict[str, object] | None = None
) -> bool:
    lrj.update_progress(current=2, target=2)
    return lrj.complete(result=result)


def train_and_predict(user: User, lrj: LongRunningJob) -> bool:
    """The work of ``train_faces``; returns whether the job completed."""
    data_known, data_unknown = split_faces_by_label(user)
    lrj.stop_if_cancelled()
    person_classifier = fit_person_classifier(data_known)

    add_cluster_centroids(user, data_known)
    if not data_known["id"]:
        # No labelled person and no cluster: there is no class to learn.
        logger.info("Nothing to train for user %s", user.id)
        return finish_without_predictions(
            lrj, {"status": "completed", "nothing_to_train": True}
        )
    filtered_encodings, filtered_ids = filter_data(
        data_known["encoding"], data_known["id"]
    )

    # Fit the classifier based on the "known" faces, including the simulated clusters
    lrj.stop_if_cancelled()
    logger.info("Before cluster fitting")
    cluster_classifier = fit_mlp(filtered_encodings, filtered_ids)
    logger.info("After cluster fitting")

    # Collect the probabilities for each unknown face. The probabilities returned
    # are arrays in the same order as the people IDs in the original training set
    unknown_encodings, unknown_ids = filter_data(
        data_unknown["encoding"], data_unknown["id"]
    )
    target_count = len(unknown_ids)
    if target_count == 0:
        logger.info("No unlabelled faces to predict")
        return finish_without_predictions(lrj)
    logger.info("Number of unlabelled faces: %s", target_count)

    classifiers = _Classifiers(
        person=person_classifier,
        cluster=cluster_classifier,
        unknown_cluster=get_unknown_cluster(user=user),
        birth_dates=birth_dates_of(user),
    )
    encodings = list(unknown_encodings)
    ids = [int(face_id) for face_id in unknown_ids]
    for start in range(0, target_count, 100):
        lrj.stop_if_cancelled()
        classify_face_page(
            classifiers,
            encodings[start : start + 100],
            ids[start : start + 100],
            lrj,
            target_count,
        )

    lrj.update_progress(current=target_count, target=target_count)
    return lrj.complete()


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
        return train_and_predict(user, lrj)
    except JobCancelledError:
        logger.info("Face training job %s was cancelled", lrj.job_id)
        return False
    except Exception as err:
        logger.exception("Face training job %s failed", lrj.job_id)
        lrj.fail(error=err)
        return False
