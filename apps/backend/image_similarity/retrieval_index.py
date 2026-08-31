import datetime

import faiss
import numpy as np
from utils import logger

embedding_size = 512


def _reshaped_embeddings(embeddings_array, user_id):
    """Return the array shaped as (n_vectors, embedding_size), or None if invalid."""
    if embeddings_array.size == 0:
        logger.warning(f"Empty embeddings array for user {user_id}")
        return None

    dimensions = len(embeddings_array.shape)
    if dimensions == 1:
        return embeddings_array.reshape(1, -1)
    if dimensions != 2:
        logger.error(f"Unexpected embedding shape: {embeddings_array.shape}")
        return None
    if embeddings_array.shape[1] != embedding_size:
        logger.error(
            f"Expected embedding size {embedding_size}, got {embeddings_array.shape[1]}"
        )
        return None
    return embeddings_array


class RetrievalIndex:
    def __init__(self):
        self.indices = {}
        self.image_hashes = {}

    def build_index_for_user(self, user_id, image_hashes, image_embeddings):
        logger.info(
            f"building index for user {user_id} - got {len(image_hashes)} photos to process"
        )
        start = datetime.datetime.now()

        # Check if we have any embeddings to process
        if not image_embeddings or len(image_embeddings) == 0:
            logger.warning(f"No embeddings provided for user {user_id}")
            return

        # Initialize or get existing index and hashes
        if not self.indices.get(user_id):
            self.indices[user_id] = faiss.IndexFlatIP(embedding_size)
        if not self.image_hashes.get(user_id):
            self.image_hashes[user_id] = []

        # FAISS expects shape (n_vectors, embedding_size)
        embeddings_array = _reshaped_embeddings(
            np.array(image_embeddings, dtype=np.float32), user_id
        )
        if embeddings_array is None:
            return

        if not self._add_embeddings(user_id, image_hashes, embeddings_array):
            return

        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "finished building index for user %d - took %.2f seconds"
            % (user_id, elapsed)
        )

    def _add_embeddings(self, user_id, image_hashes, embeddings_array):
        try:
            self.indices[user_id].add(embeddings_array)
            self.image_hashes[user_id].extend(image_hashes)
        except Exception as e:
            logger.error(
                f"Error adding embeddings to index for user {user_id}: {str(e)}"
            )
            return False
        return True

    def search_similar(self, user_id, in_embedding, n=100, thres=27.0):
        start = datetime.datetime.now()
        dist, res_indices = self.indices[user_id].search(
            np.array([in_embedding], dtype=np.float32), n
        )
        res = []
        for distance, idx in sorted(zip(dist[0], res_indices[0]), reverse=True):
            if distance >= thres:
                res.append(self.image_hashes[user_id][idx])
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "searched for %d images for user %d - took %.2f seconds"
            % (n, user_id, elapsed)
        )
        return res
