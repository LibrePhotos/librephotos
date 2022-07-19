import numpy as np
from django.db import models

from api.models.person import Person, get_unknown_person


class Cluster(models.Model):
    person = models.ForeignKey(
        Person,
        on_delete=models.SET(get_unknown_person),
        related_name="clusters",
        blank=True,
        null=True,
    )
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    name = models.TextField(null=True)

    def __str__(self):
        return "%d" % self.id

    def get_mean_encoding_array(self) -> np.ndarray:
        return np.frombuffer(bytes.fromhex(self.mean_face_encoding))

    def set_metadata(self, all_vectors):
        self.mean_face_encoding = (
            Cluster.calculate_mean_face_encoding(all_vectors).tobytes().hex()
        )

    @staticmethod
    def get_or_create_cluster_by_name(name):
        return Cluster.objects.get_or_create(name=name)[0]

    @staticmethod
    def get_or_create_cluster_by_id(cluster_id: int):
        return Cluster.objects.get_or_create(cluster_id=cluster_id)[0]

    @staticmethod
    def calculate_mean_face_encoding(all_encodings):
        return np.mean(a=all_encodings, axis=0, dtype=np.float64)
