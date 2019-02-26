import faiss
from api.models import Photo
import numpy as np

from tqdm import tqdm
from django.db.utils import ProgrammingError
from api.util import logger


class Im2VecBank(object):
    def __init__(self):
        self.index = faiss.IndexFlatL2(1024)
        self.image_hashes = []
        self.build_index()

    def add_photo_to_index(self, photo):
        encoding = np.array(
            np.frombuffer(bytes.fromhex(photo.encoding)), dtype=np.float32)
        image_hash = photo.image_hash
        self.image_hashes.append(image_hash)
        self.index.add(np.array([encoding]))

    def build_index(self):
        try:
            photos = Photo.objects.exclude(encoding=None).only(
                'image_hash', 'encoding')
            for photo in photos:
                self.add_photo_to_index(photo)
            logger.info('built im2vec faiss index successfully')
        except ProgrammingError:
            # on first start up before migration
            logger.error('built im2vec faiss index failed')
            pass

    def search_similar(self, image_hash, n=1000):
        try:
            vec = np.array(
                np.frombuffer(
                    bytes.fromhex(
                        Photo.objects.get(image_hash=image_hash).encoding)),
                dtype=np.float32)
            dist, idxes = self.index.search(np.array([vec]), 100)
            if n >= self.index.ntotal:
                n = self.index.ntotal
            res = list(
                set([(self.image_hashes[idx], d)
                    for idx, d in zip(idxes[0], dist[0])][1:n + 1]))
            res.sort(key=lambda x: x[1])
            return [{'image_hash': r[0], 'distance': r[1]} for r in res]
        except Exception as e:
            logger.error(str(e))
            return []


im2vec_bank = Im2VecBank()
