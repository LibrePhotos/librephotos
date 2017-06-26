from albums.models import Face
from albums.models import Person
import numpy as np
import base64

from sklearn.decomposition import PCA
from scipy.cluster.hierarchy import fcluster
from scipy.cluster.hierarchy import linkage
from scipy.cluster.hierarchy import dendrogram
from sklearn.manifold import TSNE
from sklearn.cluster import Birch
from sklearn import svm
from sklearn.linear_model import SGDClassifier

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
    person_id = face.person.id
    if face.person.name == 'unknown':
        face_encodings_unknown.append(face_encoding)
        id2face_unknown[face_id] = {}
        id2face_unknown[face_id]['encoding'] = face_encoding
        id2face_unknown[face_id]['image'] = face_image
        id2face_unknown[face_id]['image_path'] = face_image_path
        id2face_unknown[face_id]['person_id'] = person_id
    else:
        face_encodings_known.append(face_encoding)
        id2face_known[face_id] = {}
        id2face_known[face_id]['encoding'] = face_encoding
        id2face_known[face_id]['image'] = face_image
        id2face_known[face_id]['image_path'] = face_image_path
        id2face_known[face_id]['person_id'] = person_id


for face in faces:
    if face.person.name == 'unknown':
        persons = Person.objects.all()
        print("Who is this person? %s\nType 'new' if this person is not on the following list. \nHit enter to skip."%face.image_path)
        person_ids = [str(person.id) for person in persons]
        for person in persons:
            print("%d) %s"%(person.id,person.name))
        choice = input(">")
        if str(choice).lower().strip() == 'new':
            new_person_name = input("What is this person's name? >")
            new_person = Person(name=new_person_name)
            new_person.save()
            face.person = new_person
            face.save()

        if str(choice) in person_ids:
            this_person = Person.objects.filter(id=int(choice))[0]
            face.person = this_person
            face.save()






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


# vecs = np.array(face_encodings)
# pca = PCA(n_components=2)
# vis = pca.fit_transform(vecs)
# 
# plt.scatter(vis.T[0],vis.T[1],marker='o')
# plt.show()
# 
# Z = linkage(vecs,metric='euclidean',method='ward')
# # dendrogram(Z)
# labels = [fcluster(Z,t,criterion='distance') for t in np.linspace(0,1,100)]
# lens = [len(set(label)) for label in labels]
# 
# plt.plot(np.linspace(0,1,100),lens)
# plt.grid()
# plt.show()
# 
# clusters = fcluster(Z,4,criterion='maxclust')
# plt.scatter(vis.T[0],vis.T[1],marker='o',s=10,c=clusters)
# plt.show()
