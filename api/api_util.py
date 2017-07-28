from api.models import Photo, Face, Person, AlbumAuto, AlbumDate, AlbumUser

import ipdb
import numpy as np


from scipy import linalg
from sklearn.decomposition import PCA
import numpy as np
import matplotlib as mpl
from sklearn import cluster
from sklearn import mixture
from scipy.spatial import distance
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
from api.util import compute_bic
from sklearn.cluster import MeanShift, estimate_bandwidth

def get_count_stats():
    num_photos = Photo.objects.count()
    num_faces = Face.objects.count()
    num_people = Person.objects.count()
    num_albumauto = AlbumAuto.objects.count()
    num_albumdate = AlbumDate.objects.count()
    num_albumuser = AlbumUser.objects.count()

    res = {
        "num_photos":num_photos,
        "num_faces":num_faces,
        "num_people":num_people,
        "num_albumauto":num_albumauto,
        "num_albumdate":num_albumdate,
        "num_albumuser":num_albumuser,
    }
    return res



def get_location_clusters():
    photos_with_gps = Photo.objects.exclude(exif_gps_lat=None)

    vecs_all = np.array([[p.exif_gps_lat,p.exif_gps_lon] for p in photos_with_gps])
    # bandwidth = estimate_bandwidth(vecs_all, quantile=0.02)

    bandwidth = 0.1
    ms = MeanShift(bandwidth=bandwidth, bin_seeding=True)
    ms.fit(vecs_all)

    labels = ms.labels_
    cluster_centers = ms.cluster_centers_

    labels_unique = np.unique(labels)
    n_clusters_ = len(labels_unique)
    return cluster_centers.tolist()
