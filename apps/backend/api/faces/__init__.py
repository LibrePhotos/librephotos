"""Faces: finding them, their encodings, clustering and naming them.

- ``recognition``: the client of the ``face_recognition`` sidecar (detection
  and encodings)
- ``extractor``: where a photo's faces are (face service or XMP/EXIF regions)
- ``photo_faces``: a photo's faces saved as ``Face`` rows (crops, encodings)
- ``classify``: clustering a user's faces and training the person classifier
- ``cluster_manager``: turning a clustering result into ``Cluster`` rows
- ``social_graph``: who appears with whom
- ``geometry``: how much two face boxes overlap (duplicate faces)
- ``groups``: which of a user's person groups a person is in

``api.metadata.face_regions`` writes face regions back to the file.
"""
