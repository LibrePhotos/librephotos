import datetime

import faiss
import numpy as np
from utils import logger

embedding_size = 512


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

        # Convert embeddings to numpy array and ensure correct shape
        # FAISS expects shape (n_vectors, embedding_size)
        embeddings_array = np.array(image_embeddings, dtype=np.float32)
        
        # Handle empty or invalid arrays
        if embeddings_array.size == 0:
            logger.warning(f"Empty embeddings array for user {user_id}")
            return
            
        if len(embeddings_array.shape) == 1:
            # If we got a single vector, reshape it to (1, embedding_size)
            embeddings_array = embeddings_array.reshape(1, -1)
        elif len(embeddings_array.shape) == 2:
            # If we got multiple vectors, ensure the second dimension is embedding_size
            if embeddings_array.shape[1] != embedding_size:
                logger.error(f"Expected embedding size {embedding_size}, got {embeddings_array.shape[1]}")
                return
        else:
            logger.error(f"Unexpected embedding shape: {embeddings_array.shape}")
            return
            
        try:
            self.indices[user_id].add(embeddings_array)
            # Add hashes to the list
            self.image_hashes[user_id].extend(image_hashes)
        except Exception as e:
            logger.error(f"Error adding embeddings to index for user {user_id}: {str(e)}")
            return

        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "finished building index for user %d - took %.2f seconds"
            % (user_id, elapsed)
        )

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
