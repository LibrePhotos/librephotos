from api.models import Face
from api.models import Person

import base64
import pickle
import itertools
import ipdb

from scipy import linalg
from sklearn.decomposition import PCA
import numpy as np
import matplotlib as mpl
from sklearn import cluster
from sklearn import mixture
from scipy.spatial import distance
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import SGDClassifier
from sklearn.neural_network import MLPClassifier
from sklearn import svm


mpl.use('Agg')
import matplotlib.pyplot as plt


def cluster_faces():
    # for front end cluster visualization
    faces = Face.objects.all()
    face_encodings_all = []
    for face in faces:
        face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
        face_encodings_all.append(face_encoding)


    pca = PCA(n_components=3)
    vis_all = pca.fit_transform(np.array(face_encodings_all))

    res = []
    for face, vis in zip(faces, vis_all):
        person_id = face.person.id #color
        person_name = face.person.name
        person_label_is_inferred = face.person_label_is_inferred
        face_url = face.image.url
        value = {'x':vis[0],'y':vis[1],'size':vis[2]}
        out = {
            "person_id":person_id,
            "person_name":person_name,
            "person_label_is_inferred":person_label_is_inferred,
            "face_url":face_url,
            "value":value}
        res.append(out)
    return res



def train_faces():
    faces = Face.objects.all()

    id2face_unknown = {}
    id2face_known = {}
    face_encodings_unknown = []
    face_encodings_known = []
    face_encodings_all = []

    for face in faces:
        face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
        face_image = face.image.read()
        face.image.close()
        face_image_path = face.image_path
        face_id = face.id
        face_encodings_all.append(face_encoding)
        if face.person_label_is_inferred is not False:
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


    face_encodings_known = np.array([f['encoding'] for f in id2face_known.values()])
    person_names_known = np.array([f['person_name'] for f in id2face_known.values()])

    n_clusters = len(set(person_names_known.tolist()))

    clf = SGDClassifier(loss='log',penalty='l2')
    # clf = MLPClassifier(solver='lbfgs',alpha=1e-5,random_state=1)
    clf = svm.SVC(kernel='linear')
    # scaler = StandardScaler()
    # scaler.fit(face_encodings_all)
    # X = scaler.transform(face_encodings_known)
    X = face_encodings_known
    Y = person_names_known
    clf.fit(X, person_names_known)

    face_encodings_unknown = np.array([f['encoding'] for f in id2face_unknown.values()])
    face_paths_unknown = [f['image_path'] for f in id2face_unknown.values()]
    face_ids_unknown = [f['id'] for f in id2face_unknown.values()]
    pred = clf.predict(face_encodings_unknown)

    for face_id, person_name in zip(face_ids_unknown, pred):
        person = Person.objects.get(name=person_name)
        face = Face.objects.get(id=face_id)
        face.person = person
        face.person_label_is_inferred = True
        face.save()


    # for front end cluster visualization
    faces = Face.objects.all()
    face_encodings_all = []
    for face in faces:
        face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
        face_encodings_all.append(face_encoding)


    pca = PCA(n_components=3)
    vis_all = pca.fit_transform(np.array(face_encodings_all))

    res = []
    for face, vis in zip(faces, vis_all):
        person_id = face.person.id #color
        person_name = face.person.name
        person_label_is_inferred = face.person_label_is_inferred
        face_url = face.image.url
        value = {'x':vis[0],'y':vis[1],'size':vis[2]}
        out = {
            "person_id":person_id,
            "person_name":person_name,
            "person_label_is_inferred":person_label_is_inferred,
            "face_url":face_url,
            "value":value}
        res.append(out)
    return res



if __name__ == "__main__":
    res=train_faces()
