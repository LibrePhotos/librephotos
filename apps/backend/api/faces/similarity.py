"""Ordering the faces dashboard's groups so that look-alikes sit together (#622).

On the Inferred tab the clusters of one person ("Unknown 014", "Unknown 087")
are often far apart in name or face-count order. The "Similar" order chains
the groups by their faces: it starts at the group with the most faces and
keeps appending the group whose centroid is closest to the last one, so a
user can label one person's clusters in one pass and spot a cluster that
belongs to someone already named.

A group's centroid is the unit-length mean of its clusters' mean encodings
(``Cluster.get_mean_encoding_array``). Groups without a cluster have no
place in the chain and come after it, in the order they were given.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING

from api.lazy_import import LazyModule
from api.models.cluster import Cluster, unit_length
from api.models.user import User

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt
    from numpy import float64

    Centroid = npt.NDArray[float64]
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

# Above this many groups the chain is not built: the dashboard would wait for
# it (about 0.3 s for 2000 groups, 0.6 s for 3000 on a desktop CPU),
# and nobody scrolls through that many groups in one pass.
MAX_CHAINED_GROUPS = 3000


def similarity_ranks(user: User, groups: Sequence[tuple[int, int]]) -> dict[int, int]:
    """Each group's place in the "Similar" order, by person id.

    ``groups`` are (person id, face count) in the order the list sends them.
    Every group gets a rank, the ones without a centroid after the chain;
    none does above ``MAX_CHAINED_GROUPS``.
    """
    if not groups or len(groups) > MAX_CHAINED_GROUPS:
        return {}
    centroids = person_centroids(user, [person_id for person_id, _ in groups])
    order = similarity_chain(
        [centroids.get(person_id) for person_id, _ in groups],
        [count for _, count in groups],
    )
    return {groups[index][0]: rank for rank, index in enumerate(order)}


def person_centroids(user: User, person_ids: Sequence[int]) -> dict[int, Centroid]:
    """The unit-length mean of each person's cluster encodings, by person id.

    Only ``user``'s clusters are read. A cluster without an encoding is
    skipped, and so is one of another length than most (encodings from a
    face model the library used before).
    """
    rows = Cluster.objects.owned_by(user).filter(person__in=person_ids)
    encodings: dict[int, list[Centroid]] = defaultdict(list)
    for cluster in rows.only("person_id", "mean_face_encoding"):
        if cluster.person_id is not None and cluster.mean_face_encoding:
            encodings[cluster.person_id].append(cluster.get_mean_encoding_array())
    usual_length = _usual_length(encodings.values())
    return {
        person_id: unit_length(np.mean(kept, axis=0))
        for person_id, vectors in encodings.items()
        if (kept := [vector for vector in vectors if len(vector) == usual_length])
    }


def _usual_length(vectors_per_person: Iterable[list[Centroid]]) -> int:
    """The most common encoding length among the clusters, 0 without any."""
    lengths = Counter(
        len(vector) for vectors in vectors_per_person for vector in vectors
    )
    return lengths.most_common(1)[0][0] if lengths else 0


def similarity_chain(
    centroids: Sequence[Centroid | None], counts: Sequence[int]
) -> list[int]:
    """The groups' indices in "Similar" order: a greedy nearest-neighbour chain.

    It starts at the group with the most faces (the first of equal ones) and
    keeps appending the unvisited group whose centroid is closest to the last
    one (the highest dot product; the first of equal ones). Groups without a
    centroid follow in their given order.
    """
    present = [
        (index, centroid)
        for index, centroid in enumerate(centroids)
        if centroid is not None
    ]
    chained = [index for index, _ in present]
    unchained = [index for index, centroid in enumerate(centroids) if centroid is None]
    if not present:
        return unchained
    # float32 halves the memory the products read; the order does not need more.
    matrix = np.stack([centroid for _, centroid in present]).astype(np.float32)
    start = max(range(len(chained)), key=lambda i: (counts[chained[i]], -i))
    return [chained[i] for i in _chain(matrix, start)] + unchained


def _chain(matrix: npt.NDArray[np.float32], start: int) -> list[int]:
    """The rows of ``matrix`` from ``start``, each followed by its closest unvisited row."""
    visited = np.zeros(len(matrix), dtype=bool)
    visited[start] = True
    order = [start]
    for _ in range(len(matrix) - 1):
        # Rounded: the product's last bits differ from row to row, and equal
        # groups must compare equal. argmax takes the first of equal values,
        # so ties keep the given order.
        similarity = np.round(matrix @ matrix[order[-1]], 5)
        similarity[visited] = -np.inf
        closest = int(np.argmax(similarity))
        visited[closest] = True
        order.append(closest)
    return order
