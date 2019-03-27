from api.models import Face
from api.models import Person
from api.models import LongRunningJob
from api.util import logger

import base64
import pickle
import itertools
import ipdb

from scipy import linalg
from sklearn.decomposition import PCA
import numpy as np
from sklearn import cluster
from sklearn import mixture
from scipy.spatial import distance
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import SGDClassifier
from sklearn.neural_network import MLPClassifier
from sklearn import svm
from sklearn.manifold import TSNE

import seaborn as sns
from django_rq import job
import rq
import pytz

import datetime


def cluster_faces(user):
    # for front end cluster visualization

    people = [
        p.id
        for p in Person.objects.filter(faces__photo__owner=user).distinct()
    ]
    colors = sns.color_palette('Dark2', len(people)).as_hex()
    p2c = dict(zip(people, colors))

    faces = Face.objects.filter(photo__owner=user)
    face_encodings_all = []
    for face in faces:
        face_encoding = np.frombuffer(bytes.fromhex(face.encoding))
        face_encodings_all.append(face_encoding)

    pca = PCA(n_components=3)
    vis_all = pca.fit_transform(np.array(face_encodings_all))
    #     vis_all = TSNE(n_components=2,n_iter=100000,verbose=1).fit_transform(face_encodings_all)

    res = []
    for face, vis in zip(faces, vis_all):
        person_id = face.person.id  #color
        person_name = face.person.name
        person_label_is_inferred = face.person_label_is_inferred
        face_url = face.image.url
        value = {'x': vis[0], 'y': vis[1], 'size': vis[2]}
        #         value = {'x':vis[0],'y':vis[1],'size':0.1}
        out = {
            "person_id": person_id,
            "person_name": person_name,
            "person_label_is_inferred": person_label_is_inferred,
            "color": p2c[person_id],
            "face_url": face_url,
            "value": value
        }
        res.append(out)
    return res


@job
def train_faces(user):
    job_id = rq.get_current_job().id

    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_TRAIN_FACES)
        lrj.save()

    try:

        faces = Face.objects.filter(
            photo__owner=user).prefetch_related('person')

        id2face_unknown = {}
        id2face_known = {}
        face_encodings_unknown = []
        face_encodings_known = []
        face_encodings_all = []

        for face in faces:
            face_encoding = np.frombuffer(bytes.fromhex(face.encoding))
            face_image = face.image.read()
            face.image.close()
            face_image_path = face.image_path
            face_id = face.id
            face_encodings_all.append(face_encoding)
            if face.person_label_is_inferred is not False or face.person.name == 'unknown':
                face_encodings_unknown.append(face_encoding)
                id2face_unknown[face_id] = {}
                id2face_unknown[face_id]['encoding'] = face_encoding
                id2face_unknown[face_id]['image'] = face_image
                id2face_unknown[face_id]['image_path'] = face_image_path
                id2face_unknown[face_id]['id'] = face_id
            else:
                person_name = face.person.name
                person_id = face.person.id
                face_encodings_known.append(face_encoding)
                id2face_known[face_id] = {}
                id2face_known[face_id]['encoding'] = face_encoding
                id2face_known[face_id]['image'] = face_image
                id2face_known[face_id]['image_path'] = face_image_path
                id2face_known[face_id]['person_name'] = person_name
                id2face_known[face_id]['person_id'] = person_id

        face_encodings_known = np.array(
            [f['encoding'] for f in id2face_known.values()])
        person_names_known = np.array(
            [f['person_name'] for f in id2face_known.values()])

        n_clusters = len(set(person_names_known.tolist()))

        # clf = SGDClassifier(loss='log',penalty='l2')
        clf = MLPClassifier(
            solver='adam', alpha=1e-5, random_state=1, max_iter=1000)
        # clf = svm.SVC(kernel='linear')
        # scaler = StandardScaler()
        # scaler.fit(face_encodings_all)
        # X = scaler.transform(face_encodings_known)
        X = face_encodings_known
        Y = person_names_known
        clf.fit(X, person_names_known)

        face_encodings_unknown = np.array(
            [f['encoding'] for f in id2face_unknown.values()])
        face_paths_unknown = [
            f['image_path'] for f in id2face_unknown.values()
        ]
        face_ids_unknown = [f['id'] for f in id2face_unknown.values()]
        pred = clf.predict(face_encodings_unknown)
        probs = np.max(clf.predict_proba(face_encodings_unknown), 1)

        target_count = len(face_ids_unknown)

        for idx, (face_id, person_name, probability) in enumerate(zip(face_ids_unknown, pred, probs)):
            person = Person.objects.get(name=person_name)
            face = Face.objects.get(id=face_id)
            face.person = person
            face.person_label_is_inferred = True
            face.person_label_probability = probability
            face.save()

            lrj.result = {
                'progress': {
                    "current": idx + 1,
                    "target": target_count
                }
            }
            lrj.save()

#         res = cluster_faces()
#         print(res)

        lrj.finished = True
        lrj.failed = False
        lrj.finished_at = datetime.datetime.now()
        lrj.save()
        return True

    except BaseException as e:
        logger.error(str(e))
        res = []

        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.datetime.now()
        lrj.save()
        return False

    return res


if __name__ == "__main__":
    res = train_faces()
