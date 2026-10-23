"""HDBSCAN face clustering in numpy, a port of the ``hdbscan`` package (0.8.44).

It runs what ``hdbscan.HDBSCAN(min_cluster_size, min_samples,
cluster_selection_epsilon, metric="euclidean").fit(encodings).labels_`` runs
for face encodings (more than 60 dimensions, so Prim's algorithm): core
distances, the minimum spanning tree of the mutual reachability graph, the
single linkage tree, its condensed tree, the stability of each cluster, the
excess of mass selection with ``cluster_selection_epsilon``, and the labels.
Each step keeps the original's floating point operations and tie-breaking, so
the labels are the same, numbers included:

* Distances are the sum of squared differences in feature order, as the
  original's C loop adds them. A matrix product (BLAS) is only used to rule
  out the pairs that cannot matter, with a bound on its rounding error; every
  distance the result depends on is computed the exact way.
* The tree edges are sorted with the same ``numpy.argsort`` call, and the
  subtree stability is summed in single precision, as the original's
  ``cdef float`` does.

Not ported, because LibrePhotos never asks for them: other metrics and
algorithms, ``alpha``, ``leaf`` selection, ``allow_single_cluster``,
``max_cluster_size``, membership probabilities, outlier scores and
prediction data. Like the original, it refuses fewer than two (finite) rows.

The tree code follows ``hdbscan/_hdbscan_tree.pyx`` and
``hdbscan/_hdbscan_linkage.pyx``: Copyright (c) 2015, Leland McInnes, BSD
3-clause licence (https://github.com/scikit-learn-contrib/hdbscan).
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Self

import numpy as np
import numpy.typing as npt

# Entries of the distance matrix computed at once (32 MB a temporary).
_BLOCK_ENTRIES = 1 << 22
# Points whose exact distances are computed at once.
_EXACT_BLOCK = 4096


def exact_distances(
    rows: npt.NDArray[np.float64], point: npt.NDArray[np.float64]
) -> npt.NDArray[np.float64]:
    """The Euclidean distance of each row to ``point``, its squared differences
    added in feature order (a cumulative sum adds in order, unlike ``sum``)."""
    result = np.empty(len(rows))
    for start in range(0, len(rows), _EXACT_BLOCK):
        difference = rows[start : start + _EXACT_BLOCK] - point
        difference *= difference
        result[start : start + _EXACT_BLOCK] = np.cumsum(difference, axis=1)[:, -1]
    return np.sqrt(result)


@dataclass(frozen=True)
class _Gram:
    """Squared norms of the points, for distances from a matrix product, and
    how far such a squared distance can be from the exact one."""

    squared_norms: npt.NDArray[np.float64]
    norms: npt.NDArray[np.float64]
    relative_error: float

    @classmethod
    def of(cls, points: npt.NDArray[np.float64]) -> _Gram:
        squared_norms = np.einsum("ij,ij->i", points, points)
        # A dot product of d terms is off by at most d units in the last place
        # of the sum of the magnitudes (Higham); twice that, plus a margin,
        # also covers the exact sum's own rounding.
        relative_error = (4.0 * points.shape[1] + 16.0) * np.finfo(np.float64).eps
        return cls(squared_norms, np.sqrt(squared_norms), relative_error)

    def bounds(
        self,
        products: npt.NDArray[np.float64],
        squared_norms: npt.NDArray[np.float64],
        norms: npt.NDArray[np.float64],
    ) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
        """Lower and upper bounds on the exact squared distances of some
        vectors (their squared norms and norms) to every point, given their
        dot products with every point."""
        approximate = squared_norms[:, None] + self.squared_norms - 2.0 * products
        error = self.relative_error * (norms[:, None] + self.norms) ** 2
        return approximate - error, approximate + error


def core_distances(
    points: npt.NDArray[np.float64], min_samples: int
) -> npt.NDArray[np.float64]:
    """The distance of each point to its ``min_samples``-th nearest neighbour,
    the point itself being the 0th (``KDTree.query(k=min_samples + 1)``)."""
    # Copies of a point share its core distance: compute it once.
    queries, copies_of = np.unique(points, axis=0, return_inverse=True)
    gram = _Gram.of(points)
    query_gram = _Gram.of(queries)
    result = np.empty(len(queries))
    block = max(1, _BLOCK_ENTRIES // len(points))
    for start in range(0, len(queries), block):
        rows = slice(start, min(start + block, len(queries)))
        lower, upper = gram.bounds(
            queries[rows] @ points.T,
            query_gram.squared_norms[rows],
            query_gram.norms[rows],
        )
        # The k-th smallest upper bound is at least the k-th exact distance:
        # a point whose lower bound is above it cannot be among the k nearest.
        cutoff = np.partition(upper, min_samples, axis=1)[:, min_samples]
        row_index, column_index = np.nonzero(lower <= cutoff[:, None])
        squared = np.empty(len(row_index))
        for chunk in range(0, len(row_index), _EXACT_BLOCK):
            part = slice(chunk, chunk + _EXACT_BLOCK)
            difference = queries[row_index[part] + start] - points[column_index[part]]
            difference *= difference
            squared[part] = np.cumsum(difference, axis=1)[:, -1]
        order = np.lexsort((squared, row_index))
        first = np.searchsorted(row_index[order], np.arange(rows.stop - start))
        result[rows] = np.sqrt(squared[order][first + min_samples])
    return result[copies_of.ravel()]


class _Prim:
    """The state of Prim's algorithm: which points are in the tree, and the
    shortest known distance of every other point to it and from where."""

    def __init__(
        self, points: npt.NDArray[np.float64], core: npt.NDArray[np.float64]
    ) -> None:
        self.points = points
        self.core = core
        self.gram = _Gram.of(points)
        self.in_tree = np.zeros(len(points), dtype=bool)
        self.best = np.full(len(points), np.inf)
        self.source = np.zeros(len(points), dtype=np.intp)

    def bring_closer(self, current: int) -> None:
        """Lower the distance (and set the source) of every point outside the
        tree that is closer to ``current``, as hdbscan's inner loop does."""
        points, best = self.points, self.best
        row = slice(current, current + 1)
        lower = self.gram.bounds(
            points[row] @ points.T,
            self.gram.squared_norms[row],
            self.gram.norms[row],
        )[0][0]
        floor = np.maximum(self.core, self.core[current])
        reach_bound = np.maximum(np.sqrt(np.maximum(lower, 0.0)), floor)
        candidates = np.flatnonzero(~self.in_tree & (reach_bound < best))
        if candidates.size:
            reach = np.maximum(
                exact_distances(points[candidates], points[current]),
                floor[candidates],
            )
            closer = reach < best[candidates]
            best[candidates[closer]] = reach[closer]
            self.source[candidates[closer]] = current


def minimum_spanning_tree(
    points: npt.NDArray[np.float64], core: npt.NDArray[np.float64]
) -> npt.NDArray[np.float64]:
    """Prim's algorithm over mutual reachability distances, as hdbscan's
    ``mst_linkage_core_vector``: rows of (source, joining point, distance) in
    the order the points join, starting from point 0; the lowest index wins a
    tie."""
    prim = _Prim(points, core)
    result = np.empty((len(points) - 1, 3))
    # A copy of a point already in the tree has its distances and core
    # distance, so it cannot bring any point closer: its update is skipped.
    seen: set[bytes] = set()
    current = 0
    for step in range(len(points) - 1):
        prim.in_tree[current] = True
        key = points[current].tobytes()
        if key not in seen:
            seen.add(key)
            prim.bring_closer(current)
        remaining = np.where(prim.in_tree, np.inf, prim.best)
        joining = int(np.argmin(remaining))
        result[step] = (prim.source[joining], joining, remaining[joining])
        current = joining
    return result


def single_linkage(spanning_tree: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """The sorted spanning tree as a scipy-style linkage: rows of (cluster,
    cluster, distance, size), cluster n + i being made by row i."""
    count = len(spanning_tree) + 1
    parent = list(range(2 * count - 1))
    size = [1] * count + [0] * (count - 1)
    result = np.empty((count - 1, 4))

    def find(node: int) -> int:
        root = node
        while parent[root] != root:
            root = parent[root]
        while parent[node] != root:
            parent[node], node = root, parent[node]
        return root

    for index, (a, b, distance) in enumerate(spanning_tree.tolist()):
        left, right = find(int(a)), find(int(b))
        merged = count + index
        size[merged] = size[left] + size[right]
        parent[left] = parent[right] = merged
        result[index] = (left, right, distance, size[merged])
    return result


@dataclass(frozen=True)
class CondensedTree:
    """hdbscan's condensed tree as parallel lists, one entry per edge."""

    parent: list[int]
    child: list[int]
    lambda_val: list[float]
    child_size: list[int]

    def rows(self) -> Iterator[tuple[int, int, float, int]]:
        return zip(self.parent, self.child, self.lambda_val, self.child_size)


def _descendants(hierarchy: list[list[float]], root: int, count: int) -> list[int]:
    """``bfs_from_hierarchy``: the nodes under ``root``, breadth first."""
    result: list[int] = []
    to_process = [root]
    while to_process:
        result.extend(to_process)
        to_process = [
            int(child)
            for node in to_process
            if node >= count
            for child in hierarchy[node - count][:2]
        ]
    return result


def condense_tree(
    linkage: npt.NDArray[np.float64], min_cluster_size: int
) -> CondensedTree:
    """``condense_tree``: the single linkage tree with every split that leaves
    fewer than ``min_cluster_size`` points on a side turned into points
    falling out of their cluster."""
    hierarchy = linkage.tolist()
    root = 2 * len(hierarchy)
    count = root // 2 + 1
    next_label = count + 1
    relabel = [0] * (root + 1)
    relabel[root] = count
    ignore = [False] * (root + 1)
    tree = CondensedTree([], [], [], [])

    def add(parent: int, child: int, lambda_value: float, size: int) -> None:
        tree.parent.append(parent)
        tree.child.append(child)
        tree.lambda_val.append(lambda_value)
        tree.child_size.append(size)

    def fall_out(node: int, subtree: int, lambda_value: float) -> None:
        for sub_node in _descendants(hierarchy, subtree, count):
            if sub_node < count:
                add(relabel[node], sub_node, lambda_value, 1)
            ignore[sub_node] = True

    for node in _descendants(hierarchy, root, count):
        if ignore[node] or node < count:
            continue
        left_f, right_f, distance, _ = hierarchy[node - count]
        left, right = int(left_f), int(right_f)
        lambda_value = 1.0 / distance if distance > 0.0 else math.inf
        left_count = int(hierarchy[left - count][3]) if left >= count else 1
        right_count = int(hierarchy[right - count][3]) if right >= count else 1

        if left_count >= min_cluster_size and right_count >= min_cluster_size:
            for side, side_count in ((left, left_count), (right, right_count)):
                relabel[side] = next_label
                next_label += 1
                add(relabel[node], relabel[side], lambda_value, side_count)
        elif left_count < min_cluster_size and right_count < min_cluster_size:
            fall_out(node, left, lambda_value)
            fall_out(node, right, lambda_value)
        elif left_count < min_cluster_size:
            relabel[right] = relabel[node]
            fall_out(node, left, lambda_value)
        else:
            relabel[left] = relabel[node]
            fall_out(node, right, lambda_value)
    return tree


def compute_stability(tree: CondensedTree) -> dict[int, float]:
    """``compute_stability``: each cluster's sum over its points and child
    clusters of (lambda at which they leave - lambda at which it was born)."""
    smallest = min(tree.parent)
    births = {
        child: lambda_value for child, lambda_value in zip(tree.child, tree.lambda_val)
    }
    births[smallest] = 0.0
    stability = dict.fromkeys(range(smallest, max(tree.parent) + 1), 0.0)
    for parent, _, lambda_value, size in tree.rows():
        stability[parent] += (lambda_value - births[parent]) * size
    return stability


def _bfs(children: dict[int, list[int]], root: int) -> list[int]:
    result: list[int] = []
    to_process = [root]
    while to_process:
        result.extend(to_process)
        to_process = [child for node in to_process for child in children.get(node, [])]
    return result


def _epsilon_search(
    leaves: set[int],
    child_lookup: dict[int, tuple[int, float]],
    children: dict[int, list[int]],
    epsilon: float,
    root: int,
) -> set[int]:
    """``_epsilon_search_fast`` without ``allow_single_cluster``: a selected
    cluster born at a distance below ``epsilon`` is replaced by its closest
    ancestor born above it (never the root)."""

    def traverse_upwards(leaf: int) -> int:
        parent = child_lookup[leaf][0]
        if parent == root:
            return leaf
        if 1.0 / child_lookup[parent][1] > epsilon:
            return parent
        return traverse_upwards(parent)

    selected: list[int] = []
    processed: set[int] = set()
    for leaf in leaves:
        if 1.0 / child_lookup[leaf][1] < epsilon:
            if leaf not in processed:
                chosen = traverse_upwards(leaf)
                selected.append(chosen)
                processed.update(
                    node for node in _bfs(children, chosen) if node != chosen
                )
        else:
            selected.append(leaf)
    return set(selected)


def select_clusters(
    tree: CondensedTree, stability: dict[int, float], epsilon: float
) -> set[int]:
    """``get_clusters`` with ``cluster_selection_method="eom"``: the clusters
    of the condensed tree that make the flat clustering."""
    # Cluster ids are a topological order: children have higher ids.
    node_list = sorted(stability, reverse=True)[:-1]
    is_cluster = dict.fromkeys(node_list, True)
    children: dict[int, list[int]] = {}
    child_lookup: dict[int, tuple[int, float]] = {}
    for parent, child, lambda_value, size in tree.rows():
        if size > 1:
            children.setdefault(parent, []).append(child)
            child_lookup[child] = (parent, lambda_value)

    for node in node_list:
        # The original sums in a C float.
        subtree_stability = np.float32(0.0)
        for child in children.get(node, []):
            subtree_stability = np.float32(float(subtree_stability) + stability[child])
        if float(subtree_stability) > stability[node]:
            is_cluster[node] = False
            stability[node] = float(subtree_stability)
        else:
            for sub_node in _bfs(children, node):
                if sub_node != node:
                    is_cluster[sub_node] = False

    if epsilon != 0.0 and child_lookup:
        eom_clusters = [cluster for cluster in is_cluster if is_cluster[cluster]]
        selected = _epsilon_search(
            set(eom_clusters), child_lookup, children, epsilon, min(children)
        )
        for cluster in is_cluster:
            is_cluster[cluster] = cluster in selected
    return {cluster for cluster in is_cluster if is_cluster[cluster]}


def label_points(tree: CondensedTree, clusters: set[int]) -> npt.NDArray[np.intp]:
    """``do_labelling``: each point gets the number of its closest selected
    ancestor, by cluster id order, or -1 (noise) when it has none."""
    root = min(tree.parent)
    numbers = {cluster: number for number, cluster in enumerate(sorted(clusters))}
    label = {root: -1}
    # A parent's edge comes before its children's.
    for parent, child, _, _ in tree.rows():
        label[child] = numbers[child] if child in clusters else label[parent]
    return np.array([label[point] for point in range(root)], dtype=np.intp)


def hdbscan_labels(
    points: npt.ArrayLike,
    min_cluster_size: int,
    min_samples: int,
    cluster_selection_epsilon: float,
) -> npt.NDArray[np.intp]:
    """The cluster number of each point, -1 for noise."""
    if min_cluster_size < 2 or min_samples < 1 or cluster_selection_epsilon < 0.0:
        raise ValueError(
            "min_cluster_size must be at least 2, min_samples at least 1 and "
            "cluster_selection_epsilon at least 0"
        )
    data = np.ascontiguousarray(points, dtype=np.float64)
    labels = np.full(len(data), -1, dtype=np.intp)
    # Rows with an infinite or missing value are noise, as in the original.
    finite = np.flatnonzero(np.isfinite(data).all(axis=1))
    if len(finite) < 2:
        raise ValueError(f"Clustering needs at least two faces, got {len(finite)}")
    data = data[finite]
    core = core_distances(data, min(len(data) - 1, min_samples))
    spanning_tree = minimum_spanning_tree(data, core)
    spanning_tree = spanning_tree[np.argsort(spanning_tree.T[2]), :]
    tree = condense_tree(single_linkage(spanning_tree), min_cluster_size)
    clusters = select_clusters(tree, compute_stability(tree), cluster_selection_epsilon)
    labels[finite] = label_points(tree, clusters)
    return labels


class HDBSCAN:
    """``hdbscan.HDBSCAN`` with the parameters LibrePhotos sets."""

    def __init__(
        self,
        *,
        min_cluster_size: int,
        min_samples: int,
        cluster_selection_epsilon: float,
        metric: str = "euclidean",
    ) -> None:
        if metric != "euclidean":
            raise ValueError(f"Only the euclidean metric is supported, not {metric!r}")
        self.min_cluster_size = min_cluster_size
        self.min_samples = min_samples
        self.cluster_selection_epsilon = cluster_selection_epsilon
        self.labels_: npt.NDArray[np.intp] = np.empty(0, dtype=np.intp)

    def fit(self, points: npt.ArrayLike) -> Self:
        self.labels_ = hdbscan_labels(
            points,
            self.min_cluster_size,
            self.min_samples,
            self.cluster_selection_epsilon,
        )
        return self
