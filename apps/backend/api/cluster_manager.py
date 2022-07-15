import math
import string
import numpy as np

from numpy import ndarray

from api.models.cluster import Cluster
from api.models.face import Face
from api.models.person import Person, get_or_create_person, get_unknown_person
from bulk_update.helper import bulk_update



UNKNOWN_CLUSTER_ID = -1
GLOBAL_CLUSTER_ID = -2

FACE_CLASSIFY_COLUMNS = [
    "person",
    "person_label_is_inferred",
    "person_label_probability",
    "id",
    "cluster",
]
class ClusterManager:
    global_data_count: int = 0
    global_mean_face_encoding: string = ""

    def __init__(self) -> None:
        print("initializing ClusterManager")
        face: Face
        self.global_data_count = Face.objects.count()
        face_encodings: list[ndarray] = []
        for face in Face.objects.all():
            face_encodings.append(face.get_encoding_array())
        self.global_mean_face_encoding = Cluster.calculate_mean_face_encoding(face_encodings).tobytes().hex()

    def delete_cluster(self, cluster: Cluster):
        unknown_cluster: Cluster = self.get_unknown_cluster()
        face: Face
        face_stack = []
        for face in Face.objects.filter(cluster=cluster):
            face.cluster = unknown_cluster
            face_stack.append(face)
        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
        
        cluster.delete()
    
    def try_add_cluster(self, cluster_id: int, faces: list[Face]) -> list[Cluster]:
        added_clusters: list[Cluster] = []
        known_faces: list[Face] = []
        unknown_faces: list[Face] = []
        face_stack: list[Face] = []
        encoding_by_person: dict[int, list[np.ndarray]] = dict()

        print("Trying to add cluster {}: {}".format(cluster_id, faces))

        face:Face
        new_cluster: Cluster
        for face in faces:
            if face.person.name == "unknown" or face.person_label_is_inferred == True:
                unknown_faces.append(face)
            else:
                known_faces.append(face)
        if len(known_faces) == 0:
            new_cluster:Cluster
            if cluster_id == UNKNOWN_CLUSTER_ID:
                new_cluster = self.get_unknown_cluster()
                new_person = get_or_create_person(name="Other Unknown")
                new_person.kind = Person.KIND_CLUSTER
                new_person.save()
                new_cluster.name = "Other Unknown Cluster"
            else:
                new_person = get_or_create_person(name="Unknown " + str(cluster_id+1))
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
                encoding_by_person[new_cluster.person.id].append(face.get_encoding_array())
        else:
            clusters_by_person: dict[int, Cluster] = dict()
            mean_encoding_by_cluster: dict[int, list[np.ndarray]] = dict()
            idx:int = 0
            for face in known_faces:
                if face.person.id not in clusters_by_person.keys():
                    print("adding new cluster: {}".format(idx+1))
                    idx = idx + 1
                    new_cluster = Cluster.get_or_create_cluster_by_name("Cluster " + str(cluster_id) + "-" + str(idx))
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
                mean_encoding_by_cluster[new_cluster.id] = new_cluster.get_mean_encoding_array()
            
            # Loop over all unknown faces and find the closest "known" cluster
            for face in unknown_faces:
                closest_cluster: Cluster
                min_distance: np.float64 = np.Infinity
                encoding = face.get_encoding_array()
                for new_cluster in added_clusters:
                    distance = math.dist(encoding, mean_encoding_by_cluster[new_cluster.id])
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


    def get_unknown_cluster(self) -> Cluster:
        unknown_cluster: Cluster = Cluster.get_or_create_cluster_by_id(UNKNOWN_CLUSTER_ID)
        if unknown_cluster.person == None:
            unknown_cluster.person = get_unknown_person()
        return unknown_cluster

    def split_cluster_if_needed(self, old_cluster: Cluster) -> list[Cluster]:
        clusters_by_person: dict[int, Cluster] = dict()
        new_clusters: list[Cluster] = []
        unknown_faces: list[Face] = []
        encoding_by_person: dict[int, list[np.ndarray]] = dict()
        mean_encoding_by_cluster: dict[int, list[np.ndarray]] = dict()
        if not old_cluster.has_multiple_people():
            new_clusters.append(old_cluster)
            return new_clusters

        # Sort all faces in this cluster into unknown and known, by person
        face_stack = []
        face:Face
        new_cluster: Cluster
        idx: int = 0
        for face in Face.objects.filter(cluster=old_cluster):
            print("found face {} in cluster {}".format(face,face.cluster))
            person:Person = face.person
            if person.name != "unknown" and face.person_label_is_inferred is not True:
                print("known face found! {}, person: {}".format(face,person.id))
                print("keys: {}".format(clusters_by_person.keys()))
                if person.id not in clusters_by_person.keys():
                    print("adding new cluster: {}".format(idx+1))
                    idx = idx + 1
                    new_cluster = Cluster.get_or_create_cluster_by_name(old_cluster.name + "-" + str(idx), old_cluster.owner)
                    new_cluster.owner = old_cluster.owner
                    new_cluster.cluster_id = old_cluster.cluster_id
                    new_cluster.person = person
                    clusters_by_person[person.id] = new_cluster
                    new_clusters.append(new_cluster)
                    encoding_by_person[person.id] = []
                else:
                    print("using existing cluster")
                    new_cluster = clusters_by_person[person.id]
                face.cluster = new_cluster
                face.person_label_is_inferred = False
                face_stack.append(face)
                face.save()
                print("got here. person: {}".format(person.id))
                encoding_by_person[person.id].append(face.get_encoding_array())
                print("got after here")
            else:
                unknown_faces.append(face)
        
        print("before initial face saving")
        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
        face_stack = []
        print("finished initial face saving")
        # Set initial metadata on the split clusters based on known faces
        cluster: Cluster
        for cluster in new_clusters:
            cluster.set_metadata(encoding_by_person[cluster.person.id])
            mean_encoding_by_cluster[cluster.id] = cluster.get_mean_encoding_array()
        
        print("finished setting initial cluster metadata")
        # Loop over all unknown faces and find the closest "known" cluster
        for face in unknown_faces:
            closest_cluster: Cluster
            min_distance: np.float64 = np.Infinity
            encoding = face.get_encoding_array()
            for cluster in new_clusters:
                distance = math.dist(encoding, mean_encoding_by_cluster[cluster.id])
                if distance < min_distance:
                    closest_cluster = cluster
            face.cluster = closest_cluster
            face.person = closest_cluster.person
            face.person_label_is_inferred = True
            encoding_by_person[closest_cluster.person.id].append(encoding)
            face_stack.append(face)
            face.save()
        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)
        print("finished second face saving")
        # Update statistics again and save everything, since we've added more faces
        for cluster in new_clusters:
            cluster.set_metadata(encoding_by_person[cluster.person.id])
            cluster.save()
            
        print("finished final statistics save")
        # Finally, delete the old cluster since we don't need it anymore
        old_cluster.delete()  
        return new_clusters