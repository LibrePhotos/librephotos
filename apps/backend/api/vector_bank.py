import faiss
from api.models import Photo
import numpy as np

from tqdm import tqdm


def build_index():
    photos = Photo.objects.exclude(encoding=None).only('image_hash','encoding')

    image_hashes = []
    index = faiss.IndexFlatL2(1024)

    for photo in tqdm(photos):
        encoding = np.array(np.frombuffer(bytes.fromhex(photo.encoding)),dtype=np.float32)
#         encoding = encoding / np.sqrt(encoding.dot(encoding))
        image_hash = photo.image_hash

        image_hashes.append(image_hash)
        index.add(np.array([encoding]))

    return image_hashes, index 


image_hashes,index = build_index()

def search_similar(image_hash):
    vec = np.array(np.frombuffer(bytes.fromhex(Photo.objects.get(image_hash=image_hash).encoding)),dtype=np.float32)
#     vec = vec / np.sqrt(vec.dot(vec))
    dist, idxes = index.search(np.array([vec]),100)
    
    return [(image_hashes[idx],d) for idx,d in zip(idxes[0],dist[0])]

#aaa
