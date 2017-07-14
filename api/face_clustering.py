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

mpl.use('Agg')
import matplotlib.pyplot as plt

def compute_bic(kmeans,X):
    """
    Computes the BIC metric for a given clusters

    Parameters:
    -----------------------------------------
    kmeans:  List of clustering object from scikit learn

    X     :  multidimension np array of data points

    Returns:
    -----------------------------------------
    BIC value
    """
    # assign centers and labels
    centers = [kmeans.cluster_centers_]
    labels  = kmeans.labels_
    #number of clusters
    m = kmeans.n_clusters
    # size of the clusters
    n = np.bincount(labels)
    #size of data set
    N, d = X.shape

    #compute variance for all clusters beforehand
    cl_var = (1.0 / (N - m) / d) * sum([sum(distance.cdist(X[np.where(labels == i)], [centers[0][i]], 
             'euclidean')**2) for i in range(m)])

    const_term = 0.5 * m * np.log(N) * (d+1)

    BIC = np.sum([n[i] * np.log(n[i]) -
        n[i] * np.log(N) -
        ((n[i] * d) / 2) * np.log(2*np.pi*cl_var) -
        ((n[i] - 1) * d/ 2) for i in range(m)]) - const_term

    return(BIC)

faces_labelled = Face.objects.filter(person_label_is_inferred=False)
faces_all = Face.objects.all()

vecs_all = []
for face in faces_all:
    r = base64.b64decode(face.encoding)
    encoding = np.frombuffer(r,dtype=np.float64)
    vecs_all.append(encoding)
vecs_all = np.array(vecs_all)

vecs_labelled = []
person_labels = []
for face in faces_labelled:
    r = base64.b64decode(face.encoding)
    encoding = np.frombuffer(r,dtype=np.float64)
    vecs_labelled.append(encoding)
    person_labels.append(face.person.name)
vecs_labelled = np.array(vecs_labelled)


pca = PCA(n_components=2)
vis_all = pca.fit_transform(vecs_all)

try:
    vis_labelled = pca.transform(vecs_labelled)
except:
    vis_labelled = None


X = vecs_all
ks = range(1,15)

bics = []
bests = []
num_experiments = 20

for i_bic in range(num_experiments):
    print('bic experiment %d'%i_bic)
    # run 9 times kmeans and save each result in the KMeans object
    KMeans = [cluster.KMeans(n_clusters = i, init="k-means++").fit(vecs_all) for i in ks]
    # now run for each cluster the BIC computation
    BIC = np.log([compute_bic(kmeansi,X) for kmeansi in KMeans])
    bests.append(np.argmax(BIC))
    bics.append(BIC)
    
bics = np.array(bics)
fig = plt.figure()
plt.plot(np.arange(len(bics.mean(0)))+1,bics.mean(0))
fig.savefig('media/figs/bic.png')
plt.close(fig)

num_clusters = np.argmax(bics.mean(0))+1
print("number of clusters: %d"%num_clusters)

fig = plt.figure()
plt.scatter(vis_all.T[0],vis_all.T[1])
if vis_labelled is not None:
    for i,vis in enumerate(vis_labelled):
        plt.text(vis[0],vis[1], person_labels[i])
fig.savefig('media/figs/scatter.png')
plt.close(fig)
 
from scipy.cluster.hierarchy import fcluster
from scipy.cluster.hierarchy import linkage
from scipy.cluster.hierarchy import dendrogram

Z = linkage(vecs_all,metric='euclidean',method='ward')
dendrogram(Z)
labels = [fcluster(Z,t,criterion='distance') for t in np.linspace(0,8,100)]
lens = [len(set(label)) for label in labels]

fig = plt.figure()
plt.plot(lens)
plt.grid()
fig.savefig('media/figs/linkage.png')
plt.close(fig)

fig = plt.figure(figsize=(5,5))
clusters = fcluster(Z,num_clusters,criterion='maxclust')
plt.scatter(vis_all.T[0],vis_all.T[1],marker='.',s=10,c=clusters)
if vis_labelled is not None:
    for i,vis in enumerate(vis_labelled):
        plt.text(vis[0],vis[1], person_labels[i])
# plt.xlim([-0.5,0.5])
# plt.ylim([-0.2,0.5])
plt.title('Face Clusters')
plt.xlabel('PC1')
plt.ylabel('PC2')
plt.yticks([])
plt.xticks([])
plt.tight_layout()
fig.savefig('media/figs/linkage_scatter.png')
plt.close(fig)


# for face,cluster in zip(faces_all, clusters):
#     person_cluster = Person.objects.get_or_create(name="cluster_%d"%cluster,kind="CLUSTER",cluster_id=cluster)
#     face.person = person_cluster[0]
#     face.save()



#calculat average face embedding for each person model object
persons = Person.objects.all()
for person in persons:
    encodings = []
    faces = person.faces.all()
    for face in faces:
        r = base64.b64decode(face.encoding)
        encoding = np.frombuffer(r,dtype=np.float64)
        encodings.append(encoding)
    






