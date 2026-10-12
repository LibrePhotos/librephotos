"""Search: semantic search, similar photos and the search bar's suggestions.

- ``semantic``: the OpenCLIP model behind tags, search and similar photos
  (embeddings, query embeddings, thresholds, tag generation)
- ``similarity``: the client of the ``image_similarity`` sidecar (the FAISS
  index of a user's embeddings, similar-photo and text-query lookups)
- ``embedding_jobs``: the Calculate CLIP embeddings job and the re-embedding of
  photos made by an earlier model
- ``filters``: the photo list's search filter (semantic, OCR text and fields)
- ``term_examples``: the search term examples the search bar suggests

``api.models.photo_search`` holds the ``PhotoSearch`` model (the text index).
"""
