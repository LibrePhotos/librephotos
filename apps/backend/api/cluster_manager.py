import math
from pickle import GLOBAL
import string
import numpy as np

from numpy import ndarray
import scipy
from sklearn.metrics import zero_one_loss

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
    @staticmethod
    def get_global_data_count():
        return Face.objects.count()

    @staticmethod
    def get_global_mean_encoding() -> string:
        global_cluster: Cluster = ClusterManager.get_global_cluster()
        return global_cluster.mean_face_encoding

    @staticmethod
    def get_global_mean_encoding_array() -> ndarray:
        global_cluster: Cluster = ClusterManager.get_global_cluster()
        return np.frombuffer(bytes.fromhex(global_cluster.mean_face_encoding))

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
                new_cluster = ClusterManager.get_unknown_cluster()
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


    @staticmethod
    def get_unknown_cluster() -> Cluster:
        unknown_cluster: Cluster = Cluster.get_or_create_cluster_by_id(UNKNOWN_CLUSTER_ID)
        if unknown_cluster.person == None:
            unknown_cluster.person = get_unknown_person()
        return unknown_cluster
    
    @staticmethod
    def get_global_cluster() -> Cluster:
        global_cluster: Cluster = Cluster.objects.filter(id=GLOBAL_CLUSTER_ID).first()
        if global_cluster == None:
            global_cluster = Cluster.get_or_create_cluster_by_id(GLOBAL_CLUSTER_ID)
            face_encodings: list[ndarray] = []
            for face in Face.objects.all():
                face_encodings.append(face.get_encoding_array())
            global_cluster.mean_face_encoding = Cluster.calculate_mean_face_encoding(face_encodings).tobytes().hex()
            global_cluster.save()
        return global_cluster

    @staticmethod
    def update_face_probabilities(cluster: Cluster):
        global_cluster: Cluster = ClusterManager.get_global_cluster()
        cluster_centroid: ndarray = cluster.get_mean_encoding_array()
        std_dev = cluster.std_dev_distance
        mean_distance = cluster.mean_distance
        face_stack: list[Face] = []
        face: Face
        for face in Face.objects.filter(cluster=cluster):
            person: Person = face.person
            if person.kind == Person.KIND_CLUSTER:
                face.person_label_is_inferred = True
            if std_dev == 0:
                face.person_label_probability = 1.0
            else:
                face_encoding = face.get_encoding_array()
                distance = math.dist(cluster_centroid, face_encoding)
                z_score = (distance - mean_distance) / std_dev
                p_value = scipy.stats.norm.sf(abs(z_score))
                print("distance: {}, stddev: {}, p_value: {}".format(distance,std_dev, p_value))
                face.person_label_probability = 1 - p_value
            face_stack.append(face)
        bulk_update(face_stack, update_fields=FACE_CLASSIFY_COLUMNS)

    @staticmethod
    def add_faces_to_clusters(faces: list[Face], cluster: Cluster = None) -> bool:
        if Cluster.objects.count() == 0:
            return False

        global_cluster = ClusterManager.get_global_cluster()
        mean_encoding = ClusterManager.get_global_mean_encoding_array()
        curr_size = ClusterManager.get_global_data_count()
        face_list_by_cluster: dict[int, list[Face]] = dict()
        cluster_encodings: list[ndarray]
        target_cluster: Cluster
        cluster_stack: list[Cluster] = []
        face: Face
        for face in faces:
            encoding_array = face.get_encoding_array()
            if cluster != None:
                target_cluster = cluster
            else:
                min_distance = np.Infinity
                one_cluster: Cluster
                for one_cluster in Cluster.objects.all():
                    distance = math.dist(one_cluster.get_mean_encoding_array(), encoding_array)
                    if distance < min_distance:
                        target_cluster = one_cluster
                        min_distance = distance
            if face_list_by_cluster[target_cluster.id] == {}:
                face_list_by_cluster[target_cluster.id] = []
                cluster_stack.append(target_cluster)
            face_list_by_cluster[target_cluster.id].append(face)
        
        for id in face_list_by_cluster.keys():
            target_cluster = Cluster.objects.get(id=id)[0]
            cluster_encodings = []
            for face in Face.objects.filter(cluster=target_cluster):
                cluster_encodings.append(face.get_encoding_array())
            for face in face_list_by_cluster[id]:
                cluster_encodings.append(face.get_encoding_array())
                face.cluster = target_cluster
            target_cluster.set_metadata(cluster_encodings)
            target_cluster.save()

        bulk_update(faces, update_fields=FACE_CLASSIFY_COLUMNS)
        for target_cluster in cluster_stack:
            ClusterManager.update_face_probabilities(target_cluster)

        total_encoding: ndarray = np.multiply(mean_encoding, curr_size)
        for face in faces:
            total_encoding = np.add(total_encoding, face.get_encoding_array())
        curr_size = curr_size + len(faces)
        mean_encoding = np.divide(total_encoding, curr_size)
        global_cluster.mean_face_encoding = mean_encoding.tobytes().hex()
        global_cluster.save()


        
        
        

        





