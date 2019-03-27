import base64
import pickle
import itertools

from scipy import linalg
from sklearn.decomposition import PCA
import numpy as np
from sklearn import cluster
from sklearn import mixture
from scipy.spatial import distance
from sklearn.preprocessing import StandardScaler

import requests

from config import mapzen_api_key, mapbox_api_key

import logging
import logging.handlers

import spacy

import django_rq
from ownphotos.settings import IMAGE_SIMILARITY_SERVER

nlp = spacy.load('en_core_web_sm')

logger = logging.getLogger('ownphotos')
fomatter = logging.Formatter(
    '%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s')
fileMaxByte = 256 * 1024 * 200  # 100MB
fileHandler = logging.handlers.RotatingFileHandler(
    './logs/ownphotos.log', maxBytes=fileMaxByte, backupCount=10)
fileHandler.setFormatter(fomatter)
logger.addHandler(fileHandler)
logger.setLevel(logging.INFO)



def convert_to_degrees(values):
    """
    Helper function to convert the GPS coordinates stored in the EXIF to degress in float format
    :param value:
    :type value: exifread.utils.Ratio
    :rtype: float
    """
    d = float(values[0].num) / float(values[0].den)
    m = float(values[1].num) / float(values[1].den)
    s = float(values[2].num) / float(values[2].den)

    return d + (m / 60.0) + (s / 3600.0)

weekdays = {1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',7:'Sunday'}



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


def mapzen_reverse_geocode(lat,lon):
    url = "https://search.mapzen.com/v1/reverse?point.lat=%f&point.lon=%f&size=1&lang=en&api_key=%s"%(lat,lon,mapzen_api_key)
    resp = requests.get(url)
    if resp.status_code == 200:
        resp_json = resp.json()
        search_text = []
        if len(resp_json['features']) > 0:
            if 'country' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['country'])
            if 'county' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['county'])
            if 'macrocounty' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['macrocounty'])
            if 'locality' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['locality'])
            if 'region' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['region'])
            if 'neighbourhood' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['neighbourhood'])
            if 'name' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['name'])
            if 'label' in resp_json['features'][0]['properties'].keys():
                search_text.append(resp_json['features'][0]['properties']['label'])
        search_text = ' '.join(search_text)
        search_text = search_text.replace(',',' ')
        search_text_tokens = list(set(search_text.split()))
        search_text = ' '.join(search_text_tokens)
        resp_json['search_text'] = search_text
        return resp_json
    else:
        return {}


def mapbox_reverse_geocode(lat,lon):
    url = "https://api.mapbox.com/geocoding/v5/mapbox.places/%f,%f.json?access_token=%s"%(lon,lat,mapbox_api_key)
    resp = requests.get(url)
    if resp.status_code == 200:
        resp_json = resp.json()
        search_terms = []

        if 'features' in resp_json.keys():
            for feature in resp_json['features']:
                search_terms.append(feature['text'])

        resp_json['search_text'] = ' '.join(search_terms)
        logger.info('mapbox returned status 200.')
        return resp_json
    else:
        # logger.info('mapbox returned non 200 response.')
        logger.warning('mapbox returned status {} response.'.format(resp.status_code))
        return {}
