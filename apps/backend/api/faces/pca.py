"""Principal component analysis for the face clusters chart.

Replaces ``sklearn.decomposition.PCA(n_components).fit_transform``. The
components are the top eigenvectors of the covariance matrix, which is what
scikit-learn computes for tall data (its ``covariance_eigh`` solver) and
equals its exact ``full`` solver. For mid-sized face sets scikit-learn picked
its randomized solver, an approximation that is not seeded, so its chart
moved a little on every load; this one does not.

Signs follow scikit-learn's ``svd_flip(u_based_decision=False)``: the
largest loading (in absolute value) of each component is positive. Like
scikit-learn, it refuses fewer rows than components.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt


class PCA:
    """``sklearn.decomposition.PCA`` reduced to ``fit_transform``."""

    def __init__(self, n_components: int) -> None:
        self.n_components = n_components

    def fit_transform(self, encodings: npt.ArrayLike) -> npt.NDArray[np.float64]:
        """The coordinates of each row on the first ``n_components`` components."""
        data = np.asarray(encodings, dtype=np.float64)
        if len(data) < self.n_components:
            raise ValueError(
                f"{self.n_components} components need at least as many rows, "
                f"got {len(data)}"
            )
        centered = data - data.mean(axis=0)
        _, eigenvectors = np.linalg.eigh(centered.T @ centered)
        # eigh sorts the eigenvalues in ascending order.
        components = eigenvectors[:, ::-1][:, : self.n_components].T
        largest = np.argmax(np.abs(components), axis=1)
        components *= np.sign(components[np.arange(len(components)), largest])[:, None]
        projected = centered @ components.T
        # n rows vary in at most n - 1 directions: the rest is rounding noise.
        projected[:, len(data) - 1 :] = 0.0
        return projected
