"""Face detection (SCRFD) and recognition (ArcFace) for the face sidecar.

The part of insightface 0.7.3 the sidecar runs, ported line by line:
``app.FaceAnalysis`` restricted to detection and recognition,
``model_zoo.ModelRouter``, ``model_zoo.RetinaFace`` (the SCRFD decoder),
``model_zoo.ArcFaceONNX`` and ``utils.face_align.estimate_norm``/``norm_crop``,
with scikit-image's ``SimilarityTransform.estimate`` (Umeyama) inlined.
Importing the insightface package also imported matplotlib, scipy,
scikit-image and albumentations through modules nothing here uses.

Face embeddings are stored, and a new one is compared with the old ones, so
every number must come out as insightface computes it: keep the resizing,
the blob normalisation, the anchor decoding, the NMS, the alignment and
``cv2.warpAffine`` exactly as they are. ``api/tests/ml_services/
test_face_analysis.py`` pins the alignment; a parity run against insightface
on real pictures checked boxes, landmarks and embeddings for every pack.

Differences from insightface, none of which touches the numbers:

* every session comes from ``service.onnx_session.inference_session`` (the
  WebGPU device, thread and arena settings), not ``onnxruntime`` by name;
* a missing model directory is an error: insightface downloaded the pack
  itself, the backend's Download Models job does that here;
* a pack needs a detector with landmarks and a recognizer; the landmark,
  gender/age and swapper models in it are left out;
* the ArcFace input normalisation is the one every supported pack uses
  (mean 127.5, std 127.5): insightface sniffed it from the graph with the
  ``onnx`` package, and only MXNet exports differ.

insightface (https://github.com/deepinsight/insightface) is MIT licensed:

    MIT License

    Copyright (c) 2018 Jiankang Deng and Jia Guo

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

``_umeyama`` is ``skimage.transform._geometric._umeyama`` from scikit-image
0.26 (https://scikit-image.org), BSD-3-Clause:

    Copyright (C) 2009-2022 the scikit-image team. All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.
    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.
    3. Neither the name of the copyright holder nor the names of its
       contributors may be used to endorse or promote products derived from
       this software without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGE.
"""

from __future__ import annotations

import glob
import os
from collections.abc import Callable
from dataclasses import dataclass

import cv2
import numpy as np
import numpy.typing as npt
import onnxruntime as ort

from service._common import logger
from service.onnx_session import inference_session

Float32Array = npt.NDArray[np.float32]
Float64Array = npt.NDArray[np.float64]
ImageArray = npt.NDArray[np.uint8]

# Where ArcFace wants the five landmarks of a 112x112 crop.
ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)
DETECTION_SIZE = (640, 640)
DETECTION_THRESHOLD = 0.5
NMS_THRESHOLD = 0.4

log = logger("face_recognition")


@dataclass
class Face:
    """One detected face: box (left, top, right, bottom), landmarks, embedding."""

    bbox: Float32Array
    kps: Float32Array
    det_score: np.float32
    embedding: Float32Array


def _umeyama(src: Float32Array, dst: Float32Array) -> Float64Array:
    """The similarity transform (with scale) taking src to dst, least squares.

    "Least-squares estimation of transformation parameters between two point
    patterns", Shinji Umeyama, PAMI 1991, DOI:10.1109/34.88573. All NaN when
    the problem is not well-conditioned.
    """
    num, dim = src.shape
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_demean = src - src_mean
    dst_demean = dst - dst_mean

    # Eq. (38).
    a = dst_demean.T @ src_demean / num

    # Eq. (39).
    d = np.ones((dim,), dtype=np.float64)
    if np.linalg.det(a) < 0:
        d[dim - 1] = -1

    t = np.eye(dim + 1, dtype=np.float64)

    u, s, v = np.linalg.svd(a)

    # Eq. (40) and (43): the rank, as numpy.linalg.matrix_rank computes it.
    tol = s.max() * np.max(a.shape) * np.finfo(float).eps
    rank = np.count_nonzero(s > tol)
    if rank == 0:
        return np.nan * t
    if rank == dim - 1:
        if np.linalg.det(u) * np.linalg.det(v) > 0:
            t[:dim, :dim] = u @ v
        else:
            last = d[dim - 1]
            d[dim - 1] = -1
            t[:dim, :dim] = u @ np.diag(d) @ v
            d[dim - 1] = last
    else:
        t[:dim, :dim] = u @ np.diag(d) @ v

    # Eq. (41) and (42).
    scale = 1.0 / src_demean.var(axis=0).sum() * (s @ d)

    t[:dim, dim] = dst_mean - scale * (t[:dim, :dim] @ src_mean.T)
    t[:dim, :dim] *= scale
    return t


def estimate_norm(landmarks: Float32Array, image_size: int = 112) -> Float64Array:
    """The 2x3 affine matrix that puts five landmarks where ArcFace wants them."""
    if landmarks.shape != (5, 2):
        raise ValueError(f"expected 5 landmarks, got shape {landmarks.shape}")
    if image_size % 112 == 0:
        ratio = float(image_size) / 112.0
        diff_x = 0.0
    elif image_size % 128 == 0:
        ratio = float(image_size) / 128.0
        diff_x = 8.0 * ratio
    else:
        raise ValueError(f"no ArcFace template for a {image_size} px crop")
    dst = ARCFACE_DST * ratio
    dst[:, 0] += diff_x
    return _umeyama(landmarks, dst)[0:2, :]


def norm_crop(
    image: ImageArray, landmarks: Float32Array, image_size: int = 112
) -> ImageArray:
    """The face cut out of *image*, aligned on its landmarks, as ArcFace wants it."""
    matrix = estimate_norm(landmarks, image_size)
    warped = cv2.warpAffine(image, matrix, (image_size, image_size), borderValue=0.0)
    return np.asarray(warped, dtype=np.uint8)


def _distance2bbox(points: Float32Array, distance: Float32Array) -> Float32Array:
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _distance2kps(points: Float32Array, distance: Float32Array) -> Float32Array:
    preds = []
    for i in range(0, distance.shape[1], 2):
        preds.append(points[:, i % 2] + distance[:, i])
        preds.append(points[:, i % 2 + 1] + distance[:, i + 1])
    return np.stack(preds, axis=-1)


class Detector:
    """SCRFD with landmarks (insightface's RetinaFace class)."""

    input_mean = 127.5
    input_std = 128.0

    def __init__(self, session: ort.InferenceSession) -> None:
        self.session = session
        self.center_cache: dict[tuple[int, int, int], Float32Array] = {}
        input_cfg = session.get_inputs()[0]
        self.input_name: str = input_cfg.name
        self.output_names: list[str] = [o.name for o in session.get_outputs()]
        input_shape = input_cfg.shape
        # A model with a fixed input size keeps it; insightface ignored
        # det_size then too.
        self.input_size: tuple[int, int] = (
            DETECTION_SIZE
            if isinstance(input_shape[2], str)
            else (int(input_shape[3]), int(input_shape[2]))
        )
        if len(self.output_names) == 9:
            self.fmc = 3
            self.feat_stride_fpn = [8, 16, 32]
            self.num_anchors = 2
        elif len(self.output_names) == 15:
            self.fmc = 5
            self.feat_stride_fpn = [8, 16, 32, 64, 128]
            self.num_anchors = 1
        else:
            # 6 or 10 outputs: no landmarks, so nothing to align a face on.
            raise ValueError(
                f"detector with {len(self.output_names)} outputs has no landmarks"
            )

    def _anchor_centers(self, height: int, width: int, stride: int) -> Float32Array:
        key = (height, width, stride)
        if key in self.center_cache:
            return self.center_cache[key]
        # (x, y) of every cell: the x grid first.
        y_grid, x_grid = np.mgrid[:height, :width]
        anchor_centers = np.stack((x_grid, y_grid), axis=-1).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape((-1, 2))
        if self.num_anchors > 1:
            anchor_centers = np.stack(
                [anchor_centers] * self.num_anchors, axis=1
            ).reshape((-1, 2))
        if len(self.center_cache) < 100:
            self.center_cache[key] = anchor_centers
        return anchor_centers

    def _forward(
        self, image: ImageArray, threshold: float
    ) -> tuple[list[Float32Array], list[Float32Array], list[Float32Array]]:
        scores_list = []
        bboxes_list = []
        kpss_list = []
        input_size = tuple(image.shape[0:2][::-1])
        blob = cv2.dnn.blobFromImage(
            image,
            1.0 / self.input_std,
            input_size,
            (self.input_mean, self.input_mean, self.input_mean),
            swapRB=True,
        )
        net_outs = self.session.run(self.output_names, {self.input_name: blob})

        input_height = blob.shape[2]
        input_width = blob.shape[3]
        fmc = self.fmc
        for idx, stride in enumerate(self.feat_stride_fpn):
            scores = net_outs[idx]
            bbox_preds = net_outs[idx + fmc] * stride
            kps_preds = net_outs[idx + fmc * 2] * stride
            anchor_centers = self._anchor_centers(
                input_height // stride, input_width // stride, stride
            )
            pos_inds = np.where(scores >= threshold)[0]
            bboxes = _distance2bbox(anchor_centers, bbox_preds)
            scores_list.append(scores[pos_inds])
            bboxes_list.append(bboxes[pos_inds])
            kpss = _distance2kps(anchor_centers, kps_preds)
            kpss = kpss.reshape((kpss.shape[0], -1, 2))
            kpss_list.append(kpss[pos_inds])
        return scores_list, bboxes_list, kpss_list

    def detect(self, image: ImageArray) -> tuple[Float32Array, Float32Array]:
        """Boxes with their score (n x 5) and five landmarks each (n x 5 x 2)."""
        input_size = self.input_size
        im_ratio = float(image.shape[0]) / image.shape[1]
        model_ratio = float(input_size[1]) / input_size[0]
        if im_ratio > model_ratio:
            new_height = input_size[1]
            new_width = int(new_height / im_ratio)
        else:
            new_width = input_size[0]
            new_height = int(new_width * im_ratio)
        det_scale = float(new_height) / image.shape[0]
        resized_img = cv2.resize(image, (new_width, new_height))
        det_img = np.zeros((input_size[1], input_size[0], 3), dtype=np.uint8)
        det_img[:new_height, :new_width, :] = resized_img

        scores_list, bboxes_list, kpss_list = self._forward(
            det_img, DETECTION_THRESHOLD
        )

        scores = np.vstack(scores_list)
        order = scores.ravel().argsort()[::-1]
        bboxes = np.vstack(bboxes_list) / det_scale
        kpss = np.vstack(kpss_list) / det_scale
        pre_det = np.hstack((bboxes, scores)).astype(np.float32, copy=False)
        pre_det = pre_det[order, :]
        keep = self._nms(pre_det)
        return pre_det[keep, :], kpss[order, :, :][keep, :, :]

    @staticmethod
    def _nms(dets: Float32Array) -> list[np.intp]:
        x1 = dets[:, 0]
        y1 = dets[:, 1]
        x2 = dets[:, 2]
        y2 = dets[:, 3]
        scores = dets[:, 4]

        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1 + 1)
            h = np.maximum(0.0, yy2 - yy1 + 1)
            inter = w * h
            ovr = inter / (areas[i] + areas[order[1:]] - inter)

            inds = np.where(ovr <= NMS_THRESHOLD)[0]
            order = order[inds + 1]
        return keep


class Recognizer:
    """ArcFace: an aligned face crop in, an embedding out (insightface's ArcFaceONNX)."""

    input_mean = 127.5
    input_std = 127.5

    def __init__(self, session: ort.InferenceSession) -> None:
        self.session = session
        input_cfg = session.get_inputs()[0]
        self.input_name: str = input_cfg.name
        self.input_size: tuple[int, int] = (
            int(input_cfg.shape[3]),
            int(input_cfg.shape[2]),
        )
        outputs = session.get_outputs()
        if len(outputs) != 1:
            raise ValueError(f"recognizer with {len(outputs)} outputs")
        self.output_names: list[str] = [outputs[0].name]

    def embedding(self, image: ImageArray, landmarks: Float32Array) -> Float32Array:
        aligned = norm_crop(image, landmarks, image_size=self.input_size[0])
        blob = cv2.dnn.blobFromImages(
            [aligned],
            1.0 / self.input_std,
            self.input_size,
            (self.input_mean, self.input_mean, self.input_mean),
            swapRB=True,
        )
        net_out = self.session.run(self.output_names, {self.input_name: blob})[0]
        return np.asarray(net_out, dtype=np.float32).flatten()


def _route(session: ort.InferenceSession) -> str | None:
    """What a model of a pack does, told by its inputs and outputs as insightface did."""
    inputs = session.get_inputs()
    input_shape = inputs[0].shape
    if len(session.get_outputs()) >= 5:
        return "detection"
    if input_shape[2] == 192 and input_shape[3] == 192:
        return "landmark"
    if input_shape[2] == 96 and input_shape[3] == 96:
        return "genderage"
    if len(inputs) == 2 and input_shape[2] == 128 and input_shape[3] == 128:
        return "swapper"
    if (
        input_shape[2] == input_shape[3]
        and input_shape[2] >= 112
        and input_shape[2] % 16 == 0
    ):
        return "recognition"
    return None


class FaceAnalysis:
    """The detector and recognizer of one model pack (a directory of .onnx files)."""

    def __init__(
        self,
        model_dir: str,
        new_session: Callable[[str], ort.InferenceSession] = inference_session,
    ) -> None:
        if not os.path.isdir(model_dir):
            raise FileNotFoundError(f"no face model pack at {model_dir}")
        ort.set_default_logger_severity(3)
        detector: Detector | None = None
        recognizer: Recognizer | None = None
        # The first model of each kind in file name order wins, as in insightface.
        for onnx_file in sorted(glob.glob(os.path.join(model_dir, "*.onnx"))):
            session = new_session(onnx_file)
            task = _route(session)
            if task == "detection" and detector is None:
                detector = Detector(session)
            elif task == "recognition" and recognizer is None:
                recognizer = Recognizer(session)
            else:
                log.debug("face model %s not used (%s)", onnx_file, task)
        if detector is None or recognizer is None:
            raise FileNotFoundError(
                f"face model pack {model_dir} lacks a detector or a recognizer"
            )
        self.detector = detector
        self.recognizer = recognizer

    def get(self, image: ImageArray) -> list[Face]:
        """Every face in *image* (H x W x 3, uint8) with its embedding.

        The sidecar has always passed RGB although insightface expects BGR
        (cv2's order): the stored embeddings were made that way, so swapping
        the channels now would set new faces apart from the old ones.
        """
        bboxes, kpss = self.detector.detect(image)
        faces = []
        for i in range(bboxes.shape[0]):
            kps = kpss[i]
            faces.append(
                Face(
                    bbox=bboxes[i, 0:4],
                    kps=kps,
                    det_score=bboxes[i, 4],
                    embedding=self.recognizer.embedding(image, kps),
                )
            )
        return faces
