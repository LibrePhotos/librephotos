"""CRNN recognition with CTC greedy decoding.

Crops are normalized to the model's fixed [C, H, W], batched (sorted by aspect
ratio for throughput), run through the ONNX recognizer, and CTC-decoded.
"""

import math

import cv2
import numpy as np

DEFAULT_REC_BATCH_SIZE = 8
CTC_BLANK_INDEX = 0


def resize_norm_img(img_bgr, rec_image_shape):
    """Resize a crop to the model input and normalize to [-1, 1].

    Keeps aspect ratio at height H, caps width at W, right-pads with zeros.
    Normalization is PaddleOCR's rec scheme: (pixel/255 - 0.5) / 0.5, applied to
    the BGR crop as-is (the reference pipeline does not swap channels for rec).
    """
    img_c, img_h, img_w = rec_image_shape
    h, w = img_bgr.shape[:2]
    ratio = w / float(max(h, 1))
    if math.ceil(img_h * ratio) > img_w:
        resized_w = img_w
    else:
        resized_w = max(1, int(math.ceil(img_h * ratio)))

    resized = cv2.resize(img_bgr, (resized_w, img_h))
    resized = resized.astype(np.float32)
    resized = resized.transpose(2, 0, 1) / 255.0
    resized -= 0.5
    resized /= 0.5

    padded = np.zeros((img_c, img_h, img_w), dtype=np.float32)
    padded[:, :, :resized_w] = resized
    return padded


def ctc_greedy_decode(probs, decode_charset, blank_index=CTC_BLANK_INDEX):
    """Greedy CTC decode of a single sequence.

    ``probs`` is (T, C) of per-timestep class probabilities.  Standard CTC
    collapse: take the argmax per step, drop repeats of the previous kept class,
    drop the blank class, and map the surviving indices through ``decode_charset``
    (whose index 0 is the blank sentinel, so ``decode_charset[idx]`` is the
    character for class ``idx``).  Confidence is the mean of the per-kept-step
    max probabilities.
    """
    probs = np.asarray(probs)
    indices = probs.argmax(axis=-1)
    max_probs = probs.max(axis=-1)

    chars = []
    confidences = []
    previous = -1
    for t in range(len(indices)):
        cls = int(indices[t])
        if cls == blank_index:
            previous = cls
            continue
        if cls == previous:
            continue
        previous = cls
        if 0 <= cls < len(decode_charset):
            chars.append(decode_charset[cls])
            confidences.append(float(max_probs[t]))

    text = "".join(chars)
    confidence = float(np.mean(confidences)) if confidences else 0.0
    return text, confidence


class Recognizer:
    """Wraps the recognition ONNX session and CTC decoding."""

    def __init__(
        self,
        session,
        input_name,
        decode_charset,
        rec_image_shape,
        batch_size=DEFAULT_REC_BATCH_SIZE,
    ):
        self.session = session
        self.input_name = input_name
        self.decode_charset = decode_charset
        self.rec_image_shape = rec_image_shape
        self.batch_size = batch_size

    def recognize(self, crops):
        """Recognize a list of BGR crops, returning [(text, confidence), ...].

        Results are aligned with the input order.  Crops are processed sorted by
        aspect ratio so each batch pads to a similar width - that ordering is
        where the batched throughput comes from.
        """
        n = len(crops)
        results = [("", 0.0)] * n
        if n == 0:
            return results

        order = sorted(
            range(n),
            key=lambda i: crops[i].shape[1] / float(max(crops[i].shape[0], 1)),
        )

        for start in range(0, n, self.batch_size):
            batch_indices = order[start : start + self.batch_size]
            batch = np.stack(
                [resize_norm_img(crops[i], self.rec_image_shape) for i in batch_indices]
            ).astype(np.float32)

            outputs = self.session.run(None, {self.input_name: batch})[0]
            for j, original_index in enumerate(batch_indices):
                results[original_index] = ctc_greedy_decode(
                    outputs[j], self.decode_charset
                )
        return results
