from api.models.photo import Photo
from api.models.user import User, get_deleted_user
from django.db import models
from django.db.models import Prefetch


class Person(models.Model):
    KIND_CHOICES = (('USER', 'User Labelled'), ('CLUSTER', 'Cluster ID'),
                    ('UNKNOWN', 'Unknown Person'))
    name = models.CharField(blank=False, max_length=128)
    kind = models.CharField(choices=KIND_CHOICES, max_length=10)
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    account = models.OneToOneField(
        User, on_delete=models.SET(get_deleted_user), default=None, null=True)

    def __str__(self):
        return "%d" % self.id

    def _update_average_face_encoding(self):
        encodings = []
        faces = self.faces.all()
        for face in faces:
            r = base64.b64decode(face.encoding)
            encoding = np.frombuffer(r, dtype=np.float64)
            encodings.append(encoding)
        mean_encoding = np.array(encodings).mean(axis=0)
        self.mean_face_encoding = base64.encodebytes(mean_encoding.tostring())

    def get_photos(self, owner):
        faces = list(
            self.faces.prefetch_related(
                Prefetch(
                    'photo',
                    queryset=Photo.objects.exclude(image_hash=None).filter(hidden=False,
                        owner=owner).order_by('-exif_timestamp').only(
                            'image_hash', 'exif_timestamp', 'favorited',
                            'owner__id', 'public',
                            'hidden').prefetch_related('owner'))))

        photos = [face.photo for face in faces if hasattr(face.photo, 'owner')]
        return photos

def get_unknown_person():
    return Person.objects.get_or_create(name='unknown')[0]

def get_or_create_person(name):
    return Person.objects.get_or_create(name=name)[0]

