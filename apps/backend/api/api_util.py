from api.models import Photo, Face, Person, AlbumAuto, AlbumDate, AlbumUser

import ipdb
import numpy as np

import json
from collections import Counter

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

from django.db.models.functions import TruncMonth
from django.db.models import Sum, Count

from nltk.corpus import stopwords


from datetime import date, timedelta

def jump_by_month(start_date, end_date, month_step=1):
    current_date = start_date
    yield current_date
    while current_date < end_date:
        carry, new_month = divmod(current_date.month - 1 + month_step, 12)
        new_month += 1
        current_date = current_date.replace(year=current_date.year + carry,
                                            month=new_month)
        yield current_date



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
    # bandwidth = estimate_bandwidth(vecs_all, quantile=0.005)

    bandwidth = 0.1
    ms = MeanShift(bandwidth=bandwidth, bin_seeding=True)
    ms.fit(vecs_all)

    labels = ms.labels_
    cluster_centers = ms.cluster_centers_

    labels_unique = np.unique(labels)
    n_clusters_ = len(labels_unique)
    return cluster_centers.tolist()


def get_photo_country_counts():
    photos_with_gps = Photo.objects.exclude(geolocation_json=None)
    geolocations = [p.geolocation_json for p in photos_with_gps]
    countries = [gl['features'][0]['properties']['country'] for gl in geolocations if 'features' in gl.keys() and len(gl['features']) > 0]
    counts = Counter(countries)
    return counts



def get_photo_month_counts():
    counts = Photo.objects \
        .exclude(exif_timestamp=None) \
        .annotate(month=TruncMonth('exif_timestamp')) \
        .values('month') \
        .annotate(c=Count('image_hash')) \
        .values('month', 'c')

    all_months = [c['month'] for c in counts if c['month'].year >= 1990]
    first_month = min(all_months)
    last_month = max(all_months)

    month_span = jump_by_month(first_month,last_month)
    counts = sorted(counts, key=lambda k: k['month']) 

    res = []
    for count in counts:
        key = '-'.join([str(count['month'].year),str(count['month'].month)])
        count = count['c']
        res.append([key,count])
    res = dict(res)

    out = []
    for month in month_span:
        m = '-'.join([str(month.year),str(month.month)])
        if m in res.keys():
            out.append({'month':m,'count':res[m]})
        else:
            out.append({'month':m,'count':0})

    return out



captions_sw = ['a','of','the','on','in','at','has','holding','wearing',
    'with','this','there','man','woman','<unk>','along','no','is',
    'big','small','large','and','backtround','looking','for','it',
    'area','distance','was','white','black','brown','blue','background'
    ,'ground','lot','red','wall','green','two','one','top','bottom',
    'behind','front','building','shirt','hair','are','scene','tree',
    'trees','sky','window','windows','standing','glasses','building','buildings']


def get_searchterms_wordcloud():
    photos = Photo.objects.all()
    captions = []
    locations = []
    for photo in photos:
        if photo.search_captions:
            captions.append(photo.search_captions)
        if photo.search_location:
            locations.append(photo.search_location)

    caption_tokens = ' '.join(captions).replace(',','').split()
    location_tokens = ' '.join(locations).replace(',','').split()

    caption_tokens = [t for t in caption_tokens if not t.isdigit() and  t.lower() not in captions_sw]
    location_tokens = [t for t in location_tokens if not t.isdigit()]


    caption_token_counts = Counter(caption_tokens)
    location_token_counts = Counter(location_tokens)

    caption_token_counts = [{'label':key,'y':value} for key,value in caption_token_counts.items()]
    location_token_counts = [{'label':key,'y':value} for key,value in location_token_counts.items()]

    out = {
        'captions':caption_token_counts,
        'locations':location_token_counts
    }
    return out




