import datetime
import os
import tempfile

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


class IndexBuildError(ValueError):
    """A page of a rebuild could not be added; the rebuild is abandoned."""


class RetrievalIndex:
    """Per-user FAISS indices, kept on disk so a sidecar restart loses nothing.

    With a ``store_dir`` every user's index is saved there as
    ``<user_id>.npz`` (the serialized FAISS index and its image hashes in one
    file, so the two can never disagree) and read back on that user's first
    search after a restart. A rebuild (``begin_rebuild``, ``add_to_rebuild``,
    ``commit_rebuild``) fills a staging index while searches keep using the
    old one, writes the new file to a temporary name and swaps it in with
    ``os.replace``, then swaps it in memory.
    """

    def __init__(self, store_dir=None):
        self.indices = {}
        self.image_hashes = {}
        self.store_dir = store_dir
        self._staging = {}
        self._warned_missing = set()

    # ---------------------------------------------------------- persistence
    def _path(self, user_id):
        return os.path.join(self.store_dir, f"{int(user_id)}.npz")

    def _save(self, user_id, index, image_hashes):
        if self.store_dir is None:
            return
        os.makedirs(self.store_dir, exist_ok=True)
        handle, temporary = tempfile.mkstemp(
            dir=self.store_dir, prefix=f".{int(user_id)}.", suffix=".tmp"
        )
        try:
            with os.fdopen(handle, "wb") as out:
                np.savez(
                    out,
                    index=faiss.serialize_index(index),
                    image_hashes=np.array(image_hashes, dtype=str),
                )
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self._path(user_id))
        except BaseException:
            try:
                os.remove(temporary)
            except OSError:
                pass
            raise

    def _load(self, user_id):
        if self.store_dir is None:
            return False
        path = self._path(user_id)
        if not os.path.exists(path):
            return False
        try:
            with np.load(path, allow_pickle=False) as stored:
                index = faiss.deserialize_index(stored["index"])
                image_hashes = stored["image_hashes"].tolist()
        except Exception as e:
            logger.error(f"could not read the similarity index {path}: {e}")
            return False
        if index.ntotal != len(image_hashes):
            logger.error(
                f"similarity index {path} holds {index.ntotal} vectors for "
                f"{len(image_hashes)} photos; ignoring it"
            )
            return False
        self.indices[user_id] = index
        self.image_hashes[user_id] = image_hashes
        logger.info(f"loaded the similarity index of user {user_id} ({index.ntotal})")
        return True

    def _live(self, user_id):
        if user_id in self.indices or self._load(user_id):
            return self.indices[user_id]
        return None

    def remove_user(self, user_id):
        self.indices.pop(user_id, None)
        self.image_hashes.pop(user_id, None)
        self._staging.pop(user_id, None)
        if self.store_dir is not None:
            try:
                os.remove(self._path(user_id))
            except FileNotFoundError:
                pass

    # -------------------------------------------------------------- rebuild
    def rebuilding(self, user_id):
        return user_id in self._staging

    def staged_size(self, user_id):
        return self._staging[user_id][0].ntotal

    def abandon_rebuild(self, user_id):
        self._staging.pop(user_id, None)

    def begin_rebuild(self, user_id):
        logger.info(f"rebuilding the similarity index of user {user_id}")
        self._staging[user_id] = (faiss.IndexFlatIP(embedding_size), [])

    def add_to_rebuild(self, user_id, image_hashes, image_embeddings):
        if user_id not in self._staging:
            raise IndexBuildError(f"no rebuild in progress for user {user_id}")
        if not image_embeddings:
            return
        if len(image_hashes) != len(image_embeddings):
            raise IndexBuildError(
                f"{len(image_hashes)} image hashes for "
                f"{len(image_embeddings)} embeddings"
            )
        embeddings_array = _reshaped_embeddings(
            np.array(image_embeddings, dtype=np.float32), user_id
        )
        if embeddings_array is None:
            raise IndexBuildError("embeddings of the wrong shape")
        index, hashes = self._staging[user_id]
        index.add(embeddings_array)
        hashes.extend(image_hashes)

    def commit_rebuild(self, user_id):
        if user_id not in self._staging:
            raise IndexBuildError(f"no rebuild in progress for user {user_id}")
        index, image_hashes = self._staging.pop(user_id)
        self._save(user_id, index, image_hashes)
        self.indices[user_id] = index
        self.image_hashes[user_id] = image_hashes
        self._warned_missing.discard(user_id)
        logger.info(f"similarity index of user {user_id} now holds {index.ntotal}")
        return index.ntotal

    # ---------------------------------------------------------- incremental
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
        if self._live(user_id) is None:
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

        self._save(user_id, self.indices[user_id], self.image_hashes[user_id])

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

    # --------------------------------------------------------------- search
    def search_similar(self, user_id, in_embedding, n=100, thres=27.0):
        """Image hashes of the user's photos closest to the embedding.

        A user without an index (never built, or built before the index was
        kept on disk) has no similar photos yet rather than an error.
        """
        index = self._live(user_id)
        if index is None:
            if user_id not in self._warned_missing:
                self._warned_missing.add(user_id)
                logger.warning(
                    f"no similarity index for user {user_id}; it is built at the "
                    "end of the Calculate CLIP embeddings job"
                )
            return []

        start = datetime.datetime.now()
        dist, res_indices = index.search(np.array([in_embedding], dtype=np.float32), n)
        res = []
        for distance, idx in sorted(zip(dist[0], res_indices[0]), reverse=True):
            # FAISS pads a result shorter than n with -1.
            if idx >= 0 and distance >= thres:
                res.append(self.image_hashes[user_id][idx])
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "searched for %d images for user %d - took %.2f seconds"
            % (n, user_id, elapsed)
        )
        return res
