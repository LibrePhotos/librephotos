import os
import hashlib
from datetime import datetime

import exifread
import PIL
import face_recognition

import ipdb
from tqdm import tqdm

import numpy as np
from sklearn.decomposition import PCA
from scipy.cluster.hierarchy import fcluster
from scipy.cluster.hierarchy import linkage
from scipy.cluster.hierarchy import dendrogram
from sklearn.manifold import TSNE

import matplotlib.pyplot as plt


images_path = '../data/samplephotos'
image_paths = [os.path.abspath(os.path.join(images_path,p)) for p in os.listdir(images_path)]

thumbnails_path = '../data/thumbnails'
if not os.path.isdir(thumbnails_path):
    os.mkdir(thumbnails_path)

THUMBNAIL_SIZE = (1024,1024)

def generate_thumbnail(fname_in,fname_out,thumbnails_path):
    image = PIL.Image.open(fname_in)
    image.thumbnail(THUMBNAIL_SIZE, PIL.Image.ANTIALIAS)
    image.save(os.path.abspath(os.path.join(thumbnails_path,fname_out)),'JPEG')

def md5(fname):
    hash_md5 = hashlib.md5()
    with open(fname, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()

def extract_exif(fname):
    with open(image_path,'rb') as fimg:
        exif_raw = exifread.process_file(fimg,details=False)
        exif_processed = {}
        if 'EXIF DateTimeOriginal' in exif_raw.keys():
            tst_str = exif_raw['EXIF DateTimeOriginal'].values
            tst_dt = datetime.strptime(tst_str,"%Y:%m:%d %H:%M:%S") 
            exif_processed['timestamp'] = tst_dt 
        else:
            exif_processed['timestamp'] = None 
        if 'GPS GPSLongitude' in exif_raw.keys():
            exif_processed['gps_lat'] = exif_raw['GPS GPSLongitude'].values 
        else:
            exif_processed['gps_lat'] = None 
        if 'GPS GPSLatitude' in exif_raw.keys():
            exif_processed['gps_lon'] = exif_raw['GPS GPSLatitude'].values
        else:
            exif_processed['gps_lon'] = None 
        exif_raw = dict([(key,value.values) for key,value in exif_raw.items()])
    return {'raw':exif_raw, 'processed':exif_processed}

def extract_faces(fname):
    image = face_recognition.load_image_file(fname)
    face_encodings = face_recognition.face_encodings(image)
    face_locations = face_recognition.face_locations(image)
    if len(face_locations) > 0:
        for face_location in face_locations:
            top,right,bottom,left = face_location
            face_image = image[top:bottom, left:right]
            pil_image = PIL.Image.fromarray(face_image)
    return {'encodings':face_encodings, 'locations':face_locations}


hash2metadata = {}
for image_path in tqdm(image_paths):
    image_hash = md5(image_path)
    thumbnail_path = os.path.abspath(os.path.join(thumbnails_path,image_hash))
    generate_thumbnail(image_path,image_hash,thumbnails_path)

    metadata = {}
    metadata['img_path'] = image_path
    metadata['thumbnail_path'] = thumbnail_path
    metadata['exif'] = extract_exif(image_path)
    metadata['faces'] = extract_faces(thumbnail_path)

    hash2metadata[image_hash] = metadata



hash2tst = {}
for key,value in hash2metadata.items():
    if value['exif']['processed']['timestamp']:
        hash2tst[key] = value['exif']['processed']['timestamp']

    



faces_all = []
for key,value in hash2metadata.items():
    if len(value['faces']['encodings']) > 0:
        faces_all.extend(value['faces']['encodings'])

vecs = np.array(faces_all)
pca = PCA(n_components=2)
vis = pca.fit_transform(vecs)

plt.scatter(vis.T[0],vis.T[1],marker='o')
plt.show()

Z = linkage(vecs,metric='euclidean',method='ward')
dendrogram(Z)
labels = [fcluster(Z,t,criterion='distance') for t in np.linspace(0,1,100)]
lens = [len(set(label)) for label in labels]

plt.plot(lens)
plt.grid()
plt.show()

clusters = fcluster(Z,2,criterion='maxclust')
plt.scatter(vis.T[0],vis.T[1],marker='o',s=10,c=clusters)
plt.show()
