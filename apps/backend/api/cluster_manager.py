import numpy as np

from api.models.cluster import UNKNOWN_CLUSTER_ID, Cluster, get_unknown_cluster
from api.models.face import Face
from api.models.person import Person, get_or_create_person
from api.models.user import User
from api.util import logger


class ClusterManager:
    @staticmethod
    def try_add_cluster(
        user: User, cluster_id: int, faces: list[Face], padLen: int = 1
    ) -> list[Cluster]:
        unknown_cluster: Cluster = get_unknown_cluster(user=user)
        known_faces = [face for face in faces if face.person]
        unknown_faces = [face for face in faces if not face.person]

        if cluster_id == UNKNOWN_CLUSTER_ID:
            ClusterManager._move_to_unknown_cluster(
                unknown_cluster, unknown_faces, known_faces
            )
            return []

        if known_faces:
            added_clusters, encoding_by_person = ClusterManager._split_by_person(
                user, cluster_id, known_faces
            )
        else:
            added_clusters, encoding_by_person = ClusterManager._create_cluster_person(
                user, cluster_id, unknown_faces, padLen
            )

        for new_cluster in added_clusters:
            new_cluster.set_metadata(encoding_by_person[new_cluster.person.id])
            new_cluster.save()

        return added_clusters

    @staticmethod
    def _move_to_unknown_cluster(
        unknown_cluster: Cluster, unknown_faces: list[Face], known_faces: list[Face]
    ) -> None:
        logger.info("Adding unknown cluster")
        logger.info("Adding unknown %d faces to unknown cluster", len(unknown_faces))
        logger.info("Adding known %d faces to unknown cluster", len(known_faces))
        for face in unknown_faces:
            face.cluster = unknown_cluster
            face.cluster_person = None
            face.save()
        for face in known_faces:
            face.cluster = unknown_cluster
            face.save()

    @staticmethod
    def _create_cluster_person(
        user: User, cluster_id: int, unknown_faces: list[Face], padLen: int
    ) -> tuple[list[Cluster], dict[int, list[np.ndarray]]]:
        new_person = get_or_create_person(
            name="Unknown " + str(cluster_id).zfill(padLen),
            owner=user,
            kind=Person.KIND_CLUSTER,
        )
        new_person.cluster_owner = user
        new_person.save()

        new_cluster = Cluster.get_or_create_cluster_by_id(user, cluster_id)
        new_cluster.name = "Cluster " + str(cluster_id)
        new_cluster.person = new_person
        new_cluster.save()

        Face.objects.filter(id__in=[face.id for face in unknown_faces]).update(
            cluster=new_cluster,
            cluster_person=new_person,
        )
        encodings = [face.get_encoding_array() for face in unknown_faces]
        return [new_cluster], {new_cluster.person.id: encodings}

    @staticmethod
    def _split_by_person(
        user: User, cluster_id: int, known_faces: list[Face]
    ) -> tuple[list[Cluster], dict[int, list[np.ndarray]]]:
        added_clusters: list[Cluster] = []
        clusters_by_person: dict[int, Cluster] = dict()
        encoding_by_person: dict[int, list[np.ndarray]] = dict()
        face_ids_by_cluster: dict[int, list[int]] = dict()

        for face in known_faces:
            new_cluster = clusters_by_person.get(face.person.id)
            if new_cluster is None:
                new_cluster = Cluster.get_or_create_cluster_by_name(
                    user,
                    "Cluster " + str(cluster_id) + "-" + str(len(added_clusters) + 1),
                )
                new_cluster.cluster_id = cluster_id
                new_cluster.person = face.person
                clusters_by_person[face.person.id] = new_cluster
                added_clusters.append(new_cluster)
                encoding_by_person[face.person.id] = []
                face_ids_by_cluster[new_cluster.id] = []
            encoding_by_person[face.person.id].append(face.get_encoding_array())
            face_ids_by_cluster[new_cluster.id].append(face.id)

        for new_cluster in added_clusters:
            Face.objects.filter(id__in=face_ids_by_cluster[new_cluster.id]).update(
                cluster=new_cluster
            )

        return added_clusters, encoding_by_person
