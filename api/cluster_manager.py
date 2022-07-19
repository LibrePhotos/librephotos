import math

import numpy as np
from bulk_update.helper import bulk_update
from numpy import ndarray

from api.models.cluster import Cluster
from api.models.face import Face
from api.models.person import Person, get_or_create_person, get_unknown_person

UNKNOWN_CLUSTER_ID = -1

FACE_CLASSIFY_COLUMNS = [
    "person",
    "person_label_is_inferred",
    "person_label_probability",
    "id",
    "cluster",
]


class ClusterManager:
    @staticmethod
    def get_global_data_count():
        return Face.objects.count()

    @staticmethod
    def delete_cluster(cluster: Cluster):
        unknown_cluster: Cluster = ClusterManager.get_unknown_cluster()
        face: Face
        face_stack = []
        for face in Face.objects.filter(cluster=cluster):
            face.cluster = unknown_cluster
            face_stack.append(face)
        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)

        cluster.delete()

    @staticmethod
    def try_add_cluster(cluster_id: int, faces: list[Face]) -> list[Cluster]:
        added_clusters: list[Cluster] = []
        known_faces: list[Face] = []
        unknown_faces: list[Face] = []
        face_stack: list[Face] = []
        encoding_by_person: dict[int, list[np.ndarray]] = dict()

        face: Face
        new_cluster: Cluster
        for face in faces:
            if (
                face.person.name == "unknown"
                or face.person.name == Person.UNKNOWN_PERSON_NAME
                or face.person_label_is_inferred == True
            ):
                unknown_faces.append(face)
            else:
                known_faces.append(face)
        if len(known_faces) == 0:
            new_cluster: Cluster
            if cluster_id == UNKNOWN_CLUSTER_ID:
                new_cluster = ClusterManager.get_unknown_cluster()
                new_person = get_unknown_person()
            else:
                new_person = get_or_create_person(name="Unknown " + str(cluster_id + 1))
                new_person.kind = Person.KIND_CLUSTER
                new_person.save()
                new_cluster = Cluster.get_or_create_cluster_by_id(cluster_id)
                new_cluster.name = "Cluster " + str(cluster_id)

            new_cluster.person = new_person
            encoding_by_person[new_cluster.person.id] = []
            new_cluster.save()
            added_clusters.append(new_cluster)

            for face in unknown_faces:
                face.cluster = new_cluster
                face.person = new_person
                face.person_label_is_inferred = True
                face_stack.append(face)
                encoding_by_person[new_cluster.person.id].append(
                    face.get_encoding_array()
                )
        else:
            clusters_by_person: dict[int, Cluster] = dict()
            mean_encoding_by_cluster: dict[int, list[np.ndarray]] = dict()
            idx: int = 0
            for face in known_faces:
                if face.person.id not in clusters_by_person.keys():
                    print("adding new cluster: {}".format(idx + 1))
                    idx = idx + 1
                    new_cluster = Cluster.get_or_create_cluster_by_name(
                        "Cluster " + str(cluster_id) + "-" + str(idx)
                    )
                    new_cluster.cluster_id = cluster_id
                    new_cluster.person = face.person
                    clusters_by_person[new_cluster.person.id] = new_cluster
                    added_clusters.append(new_cluster)
                    encoding_by_person[face.person.id] = []
                else:
                    print("using existing cluster")
                    new_cluster = clusters_by_person[face.person.id]
                face.cluster = new_cluster
                face.person_label_is_inferred = False
                face_stack.append(face)
                encoding_by_person[face.person.id].append(face.get_encoding_array())

            # Set initial metadata on the split clusters based on known faces
            for new_cluster in added_clusters:
                new_cluster.set_metadata(encoding_by_person[new_cluster.person.id])
                mean_encoding_by_cluster[
                    new_cluster.id
                ] = new_cluster.get_mean_encoding_array()

            # Loop over all unknown faces and find the closest "known" cluster
            for face in unknown_faces:
                closest_cluster: Cluster
                min_distance: np.float64 = np.Infinity
                encoding = face.get_encoding_array()
                for new_cluster in added_clusters:
                    distance = math.dist(
                        encoding, mean_encoding_by_cluster[new_cluster.id]
                    )
                    if distance < min_distance:
                        closest_cluster = new_cluster
                        min_distance = distance
                face.cluster = closest_cluster
                face.person = closest_cluster.person
                face.person_label_is_inferred = True
                encoding_by_person[closest_cluster.person.id].append(encoding)
                face_stack.append(face)

        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
        # Update statistics again and save everything, since we've added more faces
        for new_cluster in added_clusters:
            new_cluster.set_metadata(encoding_by_person[new_cluster.person.id])
            new_cluster.save()

        return added_clusters

    @staticmethod
    def get_unknown_cluster() -> Cluster:
        unknown_cluster: Cluster = Cluster.get_or_create_cluster_by_id(
            UNKNOWN_CLUSTER_ID
        )
        if unknown_cluster.person == None:
            unknown_cluster.person = get_unknown_person()
            unknown_cluster.name = "Other Unknown Cluster"
            unknown_cluster.save()
        return unknown_cluster
