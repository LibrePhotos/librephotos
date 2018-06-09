from api.models import Photo, Face, AlbumDate, Person
from django.db.models import Prefetch
from api.serializers_serpy import AlbumDateListWithPhotoHashSerializer as AlbumDateListWithPhotoHashSerializerSerpy
from api.serializers import AlbumDateListWithPhotoHashSerializer as AlbumDateListWithPhotoHashSerializer

import base64
import requests
import numpy as np
from sklearn.manifold import TSNE
import matplotlib.pyplot as plt
from seaborn import color_palette
import itertools

from datetime import datetime
import face_recognition

from tqdm import tqdm

from sklearn import mixture
from scipy import linalg
from scipy.cluster.hierarchy import dendrogram, linkage
import matplotlib as mpl
from sklearn import preprocessing
from sklearn.preprocessing import StandardScaler

from sklearn.cluster import Birch, AgglomerativeClustering, DBSCAN
from sklearn.cluster import MeanShift, estimate_bandwidth

def get_or_create_person(name):
    qs = Person.objects.filter(name=name)
    if qs.count() > 0:
        return qs[0]
    else:
        new_person = Person()
        new_person.name = name
        new_person.save()
        return new_person

def get_face_encoding(face):
    return np.frombuffer(bytes.fromhex(face.encoding))

def nuke_people():
    for person in Person.objects.filter(name__startswith='Person'):
        person.delete()



faces = list(Face.objects.all())
face_encodings = np.array([np.frombuffer(bytes.fromhex(f.encoding)) for f in faces])

num_groups = []
for _ in tqdm(range(50)):
    groups = []
    np.random.shuffle(faces)
    for face in faces:
        if len(groups) == 0:
            groups.append([face])
        else:
            group_this_face_belongs_to = None
            encoding_face_curr = get_face_encoding(face)

            for group_idx, group in enumerate(groups):
                face_group_repr = group[0]
                encoding_face_group_repr = get_face_encoding(face_group_repr)
                # encoding_face_group_repr = np.array([get_face_encoding(f) for f in group]).mean(0)

                if face_recognition.compare_faces([encoding_face_group_repr], encoding_face_curr, tolerance=0.65)[0]:
                    group_this_face_belongs_to = group_idx

            if group_this_face_belongs_to:
                groups[group_this_face_belongs_to].append(face)
            else:
                groups.append([face])
    num_groups.append(len(groups))

num_people = int(np.mean(num_groups))


if False:
    faces = Face.objects.all()
    face_encodings = np.array([np.frombuffer(bytes.fromhex(f.encoding)) for f in faces])


    # Linkage clustering
    Z = AgglomerativeClustering(linkage='ward', n_clusters=num_people)
    labels = Z.fit_predict(face_encodings)
    for face,label in zip(faces,labels):
        person = get_or_create_person(name="Person %d"%label)
        face.person = person
        face.save()

# Z = linkage(face_encodings, 'ward')
# fig = plt.figure(figsize=(25, 10))
# dn = dendrogram(Z)


#mean-shift
if True:
    nuke_people()
    faces = list(Face.objects.all())
    face_encodings = np.array([np.frombuffer(bytes.fromhex(f.encoding)) for f in faces])
    X = StandardScaler().fit_transform(face_encodings)

    bandwidth = estimate_bandwidth(X, quantile=0.1, n_samples=500)

    ms = MeanShift(bandwidth=bandwidth, bin_seeding=True)
    ms.fit(X)


#DBSCAN
if False:
    nuke_people()
    faces = list(Face.objects.all())
    face_encodings = np.array([np.frombuffer(bytes.fromhex(f.encoding)) for f in faces])
    X = StandardScaler().fit_transform(face_encodings)

    # #############################################################################
    # Compute DBSCAN
    db = DBSCAN(eps=5, min_samples=2).fit(X)
    core_samples_mask = np.zeros_like(db.labels_, dtype=bool)
    core_samples_mask[db.core_sample_indices_] = True
    labels = db.labels_

    # Number of clusters in labels, ignoring noise if present.
    n_clusters_ = len(set(labels)) - (1 if -1 in labels else 0)

    for label,face in zip(labels,faces):
        person = get_or_create_person(name="Person %d"%label)
        face.person = person
        face.save()

# naive using pairwise distance threshold
if False:
    groups = []

    for face in faces:
        if len(groups) == 0:
            groups.append([face])
        else:
            group_this_face_belongs_to = None
            encoding_face_curr = get_face_encoding(face)

            for group_idx, group in enumerate(groups):
                # face_group_repr = group[0]
                encoding_face_group_repr = np.array([get_face_encoding(f) for f in group]).mean(0)

                if face_recognition.compare_faces([encoding_face_group_repr], encoding_face_curr, tolerance=0.6)[0]:
                    group_this_face_belongs_to = group_idx

            if group_this_face_belongs_to:
                groups[group_this_face_belongs_to].append(face)
            else:
                groups.append([face])

    for group_idx, group in enumerate(groups):
        person = get_or_create_person(name="Person %d"%group_idx)
        for face in group:
            face.person = person
            face.save()





# gaussian mixture model for face clustering / classification 
# and using BIC to compute the optimal number of classes
if False: 

    X = face_encodings
    X = preprocessing.normalize(face_encodings)

    # # Number of samples per component
    # n_samples = 500

    # # Generate random sample, two components
    # np.random.seed(0)
    # C = np.array([[0., -0.1], [1.7, .4]])
    # X = np.r_[np.dot(np.random.randn(n_samples, 2), C),
    #           .7 * np.random.randn(n_samples, 2) + np.array([-6, 3])]

    lowest_bic = np.infty
    bic = []
    n_components_range = [num_people]
    cv_types = ['full']
    for cv_type in cv_types:
        for n_components in tqdm(n_components_range):
            # Fit a Gaussian mixture with EM
            gmm = mixture.GaussianMixture(n_components=n_components,
                                          covariance_type=cv_type)
            gmm.fit(X)
            bic.append(gmm.bic(X))
            if bic[-1] < lowest_bic:
                lowest_bic = bic[-1]
                best_gmm = gmm

    bic = np.array(bic)
    color_iter = itertools.cycle(color_palette('Paired',20).as_hex())
    clf = best_gmm
    bars = []

    # Plot the BIC scores
    spl = plt.subplot(2, 1, 1)
    for i, (cv_type, color) in enumerate(zip(cv_types, color_iter)):
        xpos = np.array(n_components_range) + .2 * (i - 2)
        bars.append(plt.bar(xpos, bic[i * len(n_components_range):
                                      (i + 1) * len(n_components_range)],
                            width=.2, color=color))
    plt.xticks(n_components_range)
    plt.ylim([bic.min() * 1.01 - .01 * bic.max(), bic.max()])
    plt.title('BIC score per model')
    xpos = np.mod(bic.argmin(), len(n_components_range)) + .65 +\
        .2 * np.floor(bic.argmin() / len(n_components_range))
    plt.text(xpos, bic.min() * 0.97 + .03 * bic.max(), '*', fontsize=14)
    spl.set_xlabel('Number of components')
    spl.legend([b[0] for b in bars], cv_types)

    # Plot the winner
    splot = plt.subplot(2, 1, 2)
    Y_ = clf.predict(X)
    for i, (mean, cov, color) in enumerate(zip(clf.means_, clf.covariances_,
                                               color_iter)):
        # v, w = linalg.eigh(cov)
        if not np.any(Y_ == i):
            continue
        plt.scatter(X[Y_ == i, 0], X[Y_ == i, 1], .8, color=color)

        # Plot an ellipse to show the Gaussian component
        # angle = np.arctan2(w[0][1], w[0][0])
        # angle = 180. * angle / np.pi  # convert to degrees
        # v = 2. * np.sqrt(2.) * np.sqrt(v)
        # ell = mpl.patches.Ellipse(mean, v[0], v[1], 180. + angle, color=color)
        # ell.set_clip_box(splot.bbox)
        # ell.set_alpha(.5)
        # splot.add_artist(ell)

    plt.xticks(())
    plt.yticks(())
    plt.title('Selected GMM: full model, 2 components')
    plt.subplots_adjust(hspace=.35, bottom=.02)
    plt.show()


    # face_embedded = TSNE(n_components=2,n_iter=100000,verbose=1,perplexity=50).fit_transform(face_encodings)
    # plt.scatter(face_embedded[:,0],face_embedded[:,1],c=Y_)
    # plt.show()



    for cluster_id, face in zip(Y_,faces):
        print(face,cluster_id)
        person_name = 'Person %d'%cluster_id
        person = get_or_create_person(person_name)
        face.person = person
        face.person_label_is_inferred = True
        face.save()















# p = Photo.objects.first()
# image_path = p.image_path
# captions = {}
# with open(image_path, "rb") as image_file:
#     encoded_string = base64.b64encode(image_file.read())
# encoded_string = str(encoded_string)[2:-1]
# resp_captions = requests.post('http://localhost:5001/longcaptions/',data=encoded_string)




# faces = Face.objects.all()
# face_encodings = [np.frombuffer(bytes.fromhex(f.encoding)) for f in faces]
# person_ids = [f.person.id for f in faces]
# palette = color_palette('Paired',max(person_ids)+1).as_hex()
# colors = [palette[i] for i in person_ids]

# face_embedded = TSNE(n_components=2,n_iter=100000,verbose=1,perplexity=50).fit_transform(face_encodings)
# plt.scatter(face_embedded[:,0],face_embedded[:,1],c=colors)
# plt.show()






# start = datetime.now()
# qs = AlbumDate.objects.all().order_by('date').prefetch_related(
#     Prefetch('photos', queryset=Photo.objects.all().only('image_hash','exif_timestamp','favorited','hidden')))
# qs_res = list(qs)
# print('db query took %.2f seconds'%(datetime.now()-start).total_seconds())

# start = datetime.now()
# res = AlbumDateListWithPhotoHashSerializerSerpy(qs_res,many=True).data
# print('serpy serializing took %.2f seconds'%(datetime.now()-start).total_seconds())

# start = datetime.now()
# res = AlbumDateListWithPhotoHashSerializer(qs_res,many=True).data
# print('drf serializing took %.2f seconds'%(datetime.now()-start).total_seconds())












# SELECT ("api_albumdate_photos"."albumdate_id") AS "_prefetch_related_val_albumdate_id",
#        "api_photo"."image_hash",
#        "api_photo"."exif_timestamp",
#        "api_photo"."favorited",
#        "api_photo"."hidden"
#   FROM "api_photo"
#  INNER JOIN "api_albumdate_photos"
#     ON ("api_photo"."image_hash" = "api_albumdate_photos"."photo_id");