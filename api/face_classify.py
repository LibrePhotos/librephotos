from api.models import Face
from api.models import Person

import base64
import pickle
import itertools

from scipy import linalg
from sklearn.decomposition import PCA
import numpy as np
import matplotlib as mpl
from sklearn import cluster
from sklearn import mixture
from scipy.spatial import distance
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import SGDClassifier

mpl.use('Agg')
import matplotlib.pyplot as plt


faces = Face.objects.all()

id2face_unknown = {}
id2face_known = {}
face_encodings_unknown = []
face_encodings_known = []

for face in faces:
    face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
    face_image = face.image.read()
    face_image_path = face.image_path
    face_id = face.id
    if face.person_label_is_inferred is not False:
        face_encodings_unknown.append(face_encoding)
        id2face_unknown[face_id] = {}
        id2face_unknown[face_id]['encoding'] = face_encoding
        id2face_unknown[face_id]['image'] = face_image
        id2face_unknown[face_id]['image_path'] = face_image_path
    else:
        person_id = face.person.name
        face_encodings_known.append(face_encoding)
        id2face_known[face_id] = {}
        id2face_known[face_id]['encoding'] = face_encoding
        id2face_known[face_id]['image'] = face_image
        id2face_known[face_id]['image_path'] = face_image_path
        id2face_known[face_id]['person_id'] = person_id


face_encodings_known = np.array([f['encoding'] for f in id2face_known.values()])
person_ids_known = np.array([f['person_id'] for f in id2face_known.values()])

n_clusters = len(set(person_ids_known.tolist()))

# clf = svm.SVC(kernel='linear')
clf = SGDClassifier(loss='log',penalty='l2')
clf.fit(face_encodings_known, person_ids_known)

# brc = Birch(branching_factor=50,n_clusters=n_clusters,threshold=0.5,compute_labels=True)
# brc_enc = brc.fit_transform(face_encodings_known,y=person_ids_known)

face_encodings_unknown = np.array([f['encoding'] for f in id2face_unknown.values()])
face_paths_unknown = [f['image_path'] for f in id2face_unknown.values()]
pred = clf.predict(face_encodings_unknown)
probs = clf.predict_proba(face_encodings_unknown)
