import math
from django.db import models
import api.models
from api.models.person import Person, get_unknown_person
from api.models.user import User, get_deleted_user
import numpy as np


class Cluster(models.Model):
    person = models.ForeignKey(
        Person, on_delete=models.SET(get_unknown_person), related_name="clusters", blank=True, null=True
    )
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    name = models.TextField(null=True)
    std_dev_distance = models.FloatField(blank=True, null=True)
    mean_distance = models.FloatField(blank=True, null=True)

    def __str__(self):
        return "%d" % self.id
    
    def get_mean_encoding_array(self) -> np.ndarray:
        return np.frombuffer(bytes.fromhex(self.mean_face_encoding))

    def set_metadata(self, all_vectors):
        stats = Cluster.find_n_dimension_stats(all_vectors)
        self.mean_distance = stats[0]
        self.std_dev_distance = stats[1]
        self.mean_face_encoding = Cluster.calculate_mean_face_encoding(all_vectors).tobytes().hex()

    def has_multiple_people(self) -> bool:
        face:api.models.face.Face
        has_multiple = False
        current_person = ""
        for face in api.models.face.Face.objects.filter(cluster=self):
            person: Person = face.person
            if person.name != "unknown" and face.person_label_is_inferred is not True and person.kind != Person.KIND_CLUSTER:
                if current_person != "" and person.name != current_person:
                    has_multiple = True
                    break
                current_person = person.name
        return has_multiple
    
    def has_no_known_people(self) -> bool:
        face:api.models.face.Face
        for face in api.models.face.Face.objects.filter(cluster=self):
            person: Person = face.person
            if person.name != "unknown" and face.person_label_is_inferred is not True and person.kind != Person.KIND_CLUSTER:
                return False
        return True
    
    def get_linked_people(self) -> list[Person]:
        people: list[Person] = []
        person_dict: dict[Person, int] = dict()
        for face in api.models.face.Face.objects.filter(cluster=self):
            person: Person = face.person
            if not person in person_dict:
                people.append(person)
                person_dict[person] = 1
        return people


    @staticmethod
    def get_or_create_cluster_by_name(name):
        return Cluster.objects.get_or_create(name=name)[0]
    
    @staticmethod
    def get_or_create_cluster_by_id(cluster_id: int):
        return Cluster.objects.get_or_create(cluster_id=cluster_id)[0]
   
    @staticmethod
    def calculate_mean_face_encoding(all_encodings):
        return np.mean(a=all_encodings,axis=0, dtype=np.float64)
    
    @staticmethod
    def find_n_dimension_stats(all_vectors):
        mean_vector = Cluster.calculate_mean_face_encoding(all_vectors)
        distance_ary = []
        for vector in all_vectors:
            distance_ary.append(math.dist(vector,mean_vector))

        return [
            np.mean(a=distance_ary,dtype=np.float64),
            np.std(a=distance_ary,dtype=np.float64)
        ]
