from api.models import Photo, User
from api.util import logger
import requests
import numpy as np
from ownphotos.settings import IMAGE_SIMILARITY_SERVER

def search_similar_image(user,photo):
    if type(user) == int:
        user_id = user
    else:
        user_id = user.id

    image_embedding = np.array(
        np.frombuffer(bytes.fromhex(photo.encoding)), dtype=np.float32)
    post_data = {
        "user_id":user_id,
        "image_embedding":image_embedding.tolist()
    }
    res = requests.post(IMAGE_SIMILARITY_SERVER+'/search/',json=post_data)
    if res.status_code==200:
        return res.json()
    else:
        logger.error('error retrieving similar photos to {} belonging to user {}'.format(photo.image_hash,user.username))
        return []

def build_image_similarity_index(user):
    logger.info('builing similarity index for user {}'.format(user.username))
    photos = Photo.objects.filter(owner=user).exclude(encoding=None).only('encoding')

    image_hashes = []
    image_embeddings = []

    for photo in photos:
        image_hashes.append(photo.image_hash)
        image_embedding = np.array(
            np.frombuffer(bytes.fromhex(photo.encoding)), dtype=np.float32)
        image_embeddings.append(image_embedding.tolist())

    post_data = {
        "user_id":user.id,
        "image_hashes":image_hashes,
        "image_embeddings":image_embeddings
    }
    res = requests.post(IMAGE_SIMILARITY_SERVER+'/build/',json=post_data)
    return res.json()

