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
        added_clusters: list[Cluster] = []
        known_faces: list[Face] = []
        face_ids_by_cluster: dict[int, list[int]] = dict()
        unknown_faces: list[Face] = []
        unknown_ids: list[int] = []
        encoding_by_person: dict[int, list[np.ndarray]] = dict()

        face: Face
        new_cluster: Cluster
        unknown_cluster: Cluster = get_unknown_cluster(user=user)
        labelStr = str(cluster_id).zfill(padLen)
        for face in faces:
            if not face.person:
                unknown_faces.append(face)
                unknown_ids.append(face.id)
            else:
                known_faces.append(face)

        if cluster_id == UNKNOWN_CLUSTER_ID:
            logger.info("Adding unknown cluster")
            logger.info(
                "Adding unknown %d faces to unknown cluster" % len(unknown_faces)
            )
            logger.info("Adding known %d faces to unknown cluster" % len(known_faces))
            for face in unknown_faces:
                face.cluster = unknown_cluster
                face.cluster_person = None
                face.save()
            for face in known_faces:
                face.cluster = unknown_cluster
                face.save()

            return added_clusters

        if len(known_faces) == 0:
            new_cluster: Cluster
            new_person: Person

            new_person = get_or_create_person(
                name="Unknown " + labelStr, owner=user, kind=Person.KIND_CLUSTER
            )
            new_person.cluster_owner = user
            new_person.save()
            new_cluster = Cluster.get_or_create_cluster_by_id(user, cluster_id)
            new_cluster.name = "Cluster " + str(cluster_id)

            new_cluster.person = new_person
            encoding_by_person[new_cluster.person.id] = []
            new_cluster.save()
            added_clusters.append(new_cluster)

            for face in unknown_faces:
                encoding_by_person[new_cluster.person.id].append(
                    face.get_encoding_array()
                )
            Face.objects.filter(id__in=unknown_ids).update(
                cluster=new_cluster,
                cluster_person=new_person,
            )
        else:
            clusters_by_person: dict[int, Cluster] = dict()
            mean_encoding_by_cluster: dict[int, list[np.ndarray]] = dict()
            idx: int = 0
            for face in known_faces:
                if face.person.id not in clusters_by_person.keys():
                    idx = idx + 1
                    new_cluster = Cluster.get_or_create_cluster_by_name(
                        user, "Cluster " + str(cluster_id) + "-" + str(idx)
                    )
                    new_cluster.cluster_id = cluster_id
                    new_cluster.person = face.person
                    clusters_by_person[new_cluster.person.id] = new_cluster
                    added_clusters.append(new_cluster)
                    encoding_by_person[face.person.id] = []
                    face_ids_by_cluster[new_cluster.id] = []
                else:
                    new_cluster = clusters_by_person[face.person.id]
                encoding_by_person[face.person.id].append(face.get_encoding_array())
                face_ids_by_cluster[new_cluster.id].append(face.id)
            for new_cluster in added_clusters:
                Face.objects.filter(id__in=face_ids_by_cluster[new_cluster.id]).update(
                    cluster=new_cluster
                )

            # Set initial metadata on the split clusters based on known faces
            for new_cluster in added_clusters:
                new_cluster.set_metadata(encoding_by_person[new_cluster.person.id])
                mean_encoding_by_cluster[new_cluster.id] = (
                    new_cluster.get_mean_encoding_array()
                )

            # Clear the face IDs list to prepare for processing the unknown faces
            for new_cluster in added_clusters:
                face_ids_by_cluster[new_cluster.id] = []

            for new_cluster in added_clusters:
                Face.objects.filter(id__in=face_ids_by_cluster[new_cluster.id]).update(
                    cluster=new_cluster,
                    cluster_person=new_cluster.person,
                )

        # Update statistics again and save everything, since we've added more faces
        for new_cluster in added_clusters:
            new_cluster.set_metadata(encoding_by_person[new_cluster.person.id])
            new_cluster.save()

        return added_clusters
