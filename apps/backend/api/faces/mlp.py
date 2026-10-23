"""The face classifier: scikit-learn's ``MLPClassifier`` (1.9) in numpy.

Training predicts which person an unlabelled face shows. This is the network
``MLPClassifier(solver="adam", alpha=..., random_state=..., max_iter=...)``
trains with every other parameter at its default: one hidden layer of 100
ReLU units, Glorot-uniform initial weights from ``RandomState(random_state)``,
mini-batches of 200 shuffled every epoch with that same generator, Adam
(learning rate 0.001, betas 0.9 and 0.999, epsilon 1e-8), L2 penalty
``alpha``, and a stop after more than 10 epochs without the training loss
improving by 1e-4. The output is a softmax over the classes, or a single
logistic unit for one or two classes, exactly as scikit-learn's
``LabelBinarizer`` sets it up: one class still gets two probability columns
(``1 - p`` and ``p``) next to its one entry in ``classes_``.

Every array operation is the one scikit-learn runs, in the same order, so the
same data and seed give the same weights, iteration count and probabilities.

Ported from ``sklearn/neural_network/_multilayer_perceptron.py``,
``_base.py`` and ``_stochastic_optimizers.py``: Copyright (c) the
scikit-learn developers, BSD 3-clause licence (https://scikit-learn.org).
"""

from __future__ import annotations

from itertools import pairwise
from typing import Self

import numpy as np
import numpy.typing as npt

HIDDEN_UNITS = 100
BATCH_SIZE = 200
LEARNING_RATE = 0.001
BETA_1 = 0.9
BETA_2 = 0.999
EPSILON = 1e-8
TOL = 1e-4
N_ITER_NO_CHANGE = 10

FloatArray = npt.NDArray[np.float64]
BoolArray = npt.NDArray[np.bool_]
IntArray = npt.NDArray[np.int64]


def _xlogy(x: BoolArray, y: FloatArray) -> FloatArray:
    """``scipy.special.xlogy`` for an x of 0 or 1: 0 where x is 0, else log(y)."""
    return np.where(x, x * np.log(y), 0.0)


def _logistic(values: FloatArray) -> FloatArray:
    """``scipy.special.expit``, in place."""
    with np.errstate(over="ignore"):
        np.negative(values, out=values)
        np.exp(values, out=values)
        values += 1
        np.divide(1, values, out=values)
    return values


def _softmax(values: FloatArray) -> FloatArray:
    """scikit-learn's ``inplace_softmax``."""
    shifted = values - values.max(axis=1)[:, np.newaxis]
    np.exp(shifted, out=values)
    values /= values.sum(axis=1)[:, np.newaxis]
    return values


def _binarize(labels: IntArray, classes: IntArray) -> BoolArray:
    """``LabelBinarizer().fit(labels).transform(labels)`` as booleans."""
    if len(classes) == 1:
        return np.zeros((len(labels), 1), dtype=np.bool_)
    if len(classes) == 2:
        return np.asarray((labels == classes[1])[:, np.newaxis], dtype=np.bool_)
    return np.asarray(labels[:, np.newaxis] == classes[np.newaxis, :], dtype=np.bool_)


class MLPClassifier:
    """``sklearn.neural_network.MLPClassifier`` with the Adam solver."""

    def __init__(self, *, alpha: float, random_state: int, max_iter: int) -> None:
        self.alpha = alpha
        self.random_state = random_state
        self.max_iter = max_iter
        # The person ids, in increasing order.
        self.classes_: list[int] = []
        self.coefs_: list[FloatArray] = []
        self.intercepts_: list[FloatArray] = []
        self.n_iter_ = 0

    @property
    def _softmax_output(self) -> bool:
        return len(self.classes_) > 2

    def _forward(self, inputs: FloatArray) -> tuple[FloatArray, FloatArray]:
        """The hidden layer's activations and the output probabilities."""
        hidden = inputs @ self.coefs_[0]
        hidden += self.intercepts_[0]
        np.maximum(hidden, 0, out=hidden)
        output = hidden @ self.coefs_[1]
        output += self.intercepts_[1]
        if self._softmax_output:
            return hidden, _softmax(output)
        return hidden, _logistic(output)

    def _loss(self, targets: BoolArray, probabilities: FloatArray) -> float:
        eps = np.finfo(probabilities.dtype).eps
        clipped = np.clip(probabilities, eps, 1 - eps)
        if self._softmax_output:
            loss = -np.average(_xlogy(targets, clipped), axis=0).sum()
        else:
            loss = -np.average(
                _xlogy(targets, clipped) + _xlogy(~targets, 1 - clipped), axis=0
            ).sum()
        values = 0.0
        for coefs in self.coefs_:
            flat = coefs.ravel()
            values += np.dot(flat, flat)
        return float(loss + (0.5 * self.alpha) * values / len(targets))

    def _gradients(
        self, inputs: FloatArray, targets: BoolArray
    ) -> tuple[float, list[FloatArray]]:
        """The batch's loss and the gradients of the weights then the biases."""
        count = len(inputs)
        hidden, probabilities = self._forward(inputs)
        loss = self._loss(targets, probabilities)

        output_delta = probabilities - targets
        output_coef_grad = hidden.T @ output_delta
        output_coef_grad += self.alpha * self.coefs_[1]
        output_coef_grad /= count
        output_intercept_grad = np.sum(output_delta, axis=0) / count

        hidden_delta = output_delta @ self.coefs_[1].T
        hidden_delta[hidden == 0] = 0
        hidden_coef_grad = inputs.T @ hidden_delta
        hidden_coef_grad += self.alpha * self.coefs_[0]
        hidden_coef_grad /= count
        hidden_intercept_grad = np.sum(hidden_delta, axis=0) / count
        return loss, [
            hidden_coef_grad,
            output_coef_grad,
            hidden_intercept_grad,
            output_intercept_grad,
        ]

    def fit(self, encodings: npt.ArrayLike, labels: npt.ArrayLike) -> Self:
        inputs = np.asarray(encodings, dtype=np.float64)
        label_array = np.asarray(labels, dtype=np.int64)
        classes = np.unique(label_array)
        self.classes_ = classes.tolist()
        targets = _binarize(label_array, classes)
        random_state = np.random.RandomState(self.random_state)

        self.coefs_, self.intercepts_ = [], []
        for fan_in, fan_out in pairwise(
            [inputs.shape[1], HIDDEN_UNITS, targets.shape[1]]
        ):
            bound = np.sqrt(6.0 / (fan_in + fan_out))
            self.coefs_.append(random_state.uniform(-bound, bound, (fan_in, fan_out)))
            self.intercepts_.append(random_state.uniform(-bound, bound, fan_out))
        parameters = self.coefs_ + self.intercepts_
        first_moments = [np.zeros_like(parameter) for parameter in parameters]
        second_moments = [np.zeros_like(parameter) for parameter in parameters]

        count = len(inputs)
        batch_size = min(BATCH_SIZE, count)
        order = np.arange(count, dtype=int)
        best_loss = np.inf
        no_improvement = 0
        step = 0
        self.n_iter_ = 0
        for _ in range(self.max_iter):
            permutation = np.arange(count)
            random_state.shuffle(permutation)
            order = order[permutation]
            accumulated_loss = 0.0
            for start in range(0, count, batch_size):
                batch = order[start : start + batch_size]
                loss, gradients = self._gradients(inputs[batch], targets[batch])
                accumulated_loss += loss * len(batch)

                step += 1
                first_moments = [
                    BETA_1 * moment + (1 - BETA_1) * gradient
                    for moment, gradient in zip(first_moments, gradients)
                ]
                second_moments = [
                    BETA_2 * moment + (1 - BETA_2) * (gradient**2)
                    for moment, gradient in zip(second_moments, gradients)
                ]
                learning_rate = (
                    LEARNING_RATE * np.sqrt(1 - BETA_2**step) / (1 - BETA_1**step)
                )
                for parameter, first, second in zip(
                    parameters, first_moments, second_moments
                ):
                    update = -learning_rate * first / (np.sqrt(second) + EPSILON)
                    np.add(parameter, update, out=parameter)

            self.n_iter_ += 1
            epoch_loss = accumulated_loss / count
            if epoch_loss > best_loss - TOL:
                no_improvement += 1
            else:
                no_improvement = 0
            best_loss = min(best_loss, epoch_loss)
            if no_improvement > N_ITER_NO_CHANGE:
                break

        if not all(np.isfinite(parameter).all() for parameter in parameters):
            raise ValueError("Training produced non-finite weights")
        return self

    def predict_proba(self, encodings: npt.ArrayLike) -> FloatArray:
        """The probability of each class (in ``classes_`` order) for each row."""
        _, probabilities = self._forward(np.asarray(encodings, dtype=np.float64))
        if probabilities.shape[1] == 1:
            positive = probabilities.ravel()
            return np.vstack([1 - positive, positive]).T
        return probabilities
