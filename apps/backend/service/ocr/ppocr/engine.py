"""PP-OCRv6 engine: lazy singleton loaded once, mirrors the SigLIP2 shape.

``load`` / ``unload`` / ``predict`` match the other sidecar model wrappers so
main.py can hold a single lazily-created instance.  ``predict`` is the whole
pipeline: read image -> detect -> (optionally) recognize -> assemble blocks in
reading order.

The reading-order and text-area helpers are pure functions, unit-tested without
any model.
"""

import numpy as np
import onnxruntime as ort

from .config import OCRConfig
from .crop import get_rotate_crop_image
from .detect import detect, polygon_area, read_image
from .recognize import Recognizer

# A block is kept only if the recognizer is at least this confident AND it has
# at least this many characters (junk suppression).  Both are overridable per
# request via min_confidence; MIN_BLOCK_CHARS is fixed policy.
MIN_BLOCK_CHARS = 2


def box_area(box):
    """Area of a (4, 2) quad."""
    return float(polygon_area(box))


def text_area_fraction(boxes, image_height, image_width):
    """Sum of detected box areas over image area, clamped to [0, 1].

    Computed from ALL detected boxes, before any confidence/length filtering -
    it is a "how much text-like area is present" signal, not a quality signal.
    """
    image_area = float(image_height) * float(image_width)
    if image_area <= 0:
        return 0.0
    total = sum(box_area(box) for box in boxes)
    return float(min(1.0, total / image_area))


def reading_order_sort(blocks, row_tolerance=None):
    """Order blocks top-to-bottom, then left-to-right within a row.

    Blocks whose vertical centers fall within ``row_tolerance`` of a running row
    center are grouped into the same row; rows are emitted top-down and each
    row's blocks left-to-right.  ``row_tolerance`` defaults to half the median
    block height, which adapts to the text size in the image.
    """
    if not blocks:
        return []

    items = []
    for block in blocks:
        box = np.asarray(block["box"], dtype=np.float64)
        ys = box[:, 1]
        xs = box[:, 0]
        items.append(
            {
                "block": block,
                "cy": float(ys.mean()),
                "left": float(xs.min()),
                "height": float(ys.max() - ys.min()),
            }
        )

    if row_tolerance is None:
        median_height = float(np.median([it["height"] for it in items]))
        row_tolerance = max(1.0, median_height * 0.5)

    items.sort(key=lambda it: it["cy"])

    rows = []
    for item in items:
        placed = False
        for row in rows:
            if abs(item["cy"] - row["cy"]) <= row_tolerance:
                row["items"].append(item)
                row["cy"] = float(np.mean([it["cy"] for it in row["items"]]))
                placed = True
                break
        if not placed:
            rows.append({"cy": item["cy"], "items": [item]})

    rows.sort(key=lambda row: row["cy"])
    ordered = []
    for row in rows:
        row["items"].sort(key=lambda it: it["left"])
        ordered.extend(it["block"] for it in row["items"])
    return ordered


class PPOCREngine:
    """Lazily-loaded detection + recognition pipeline."""

    def __init__(self, model_dir=None):
        self._model_dir = model_dir
        self.config = None
        self.det_session = None
        self.rec_session = None
        self.recognizer = None
        self.det_input_name = None
        self.is_loaded = False

    def load(self):
        self.config = OCRConfig(self._model_dir)
        providers = ["CPUExecutionProvider"]
        self.det_session = ort.InferenceSession(
            self.config.det_model_path, providers=providers
        )
        self.rec_session = ort.InferenceSession(
            self.config.rec_model_path, providers=providers
        )

        self.det_input_name = self.det_session.get_inputs()[0].name
        rec_input_name = self.rec_session.get_inputs()[0].name

        # Validate the charset against the model's recognition width before we
        # ever decode: a mismatch shifts every character by one.  This raises
        # OCRConfigError and refuses to finish loading on mismatch.
        rec_output_dim = self.rec_session.get_outputs()[0].shape[-1]
        decode_charset = self.config.build_decode_charset(rec_output_dim)

        self.recognizer = Recognizer(
            self.rec_session,
            rec_input_name,
            decode_charset,
            self.config.rec_input_shape,
        )
        self.is_loaded = True

    def unload(self):
        del self.det_session
        del self.rec_session
        del self.recognizer
        self.det_session = None
        self.rec_session = None
        self.recognizer = None
        self.config = None
        self.det_input_name = None
        self.is_loaded = False

    def predict(self, image_path, min_confidence=0.6, max_side=None, det_only=False):
        """Run the pipeline on one image.

        Returns a dict following the /ocr endpoint contract.  In ``det_only``
        mode recognition is skipped and only the detection-derived signals are
        returned.
        """
        if not self.is_loaded:
            self.load()

        if max_side is None:
            max_side = self.config.det_max_side

        image = read_image(image_path)
        height, width = image.shape[:2]

        boxes, _ = detect(
            self.det_session, self.det_input_name, image, self.config, max_side
        )
        area_fraction = text_area_fraction(boxes, height, width)

        if det_only:
            return {
                "text_area_fraction": area_fraction,
                "box_count": len(boxes),
            }

        crops = [get_rotate_crop_image(image, box) for box in boxes]
        recognized = self.recognizer.recognize(crops)

        candidate_blocks = []
        for box, (text, confidence) in zip(boxes, recognized):
            stripped = text.strip()
            if confidence < min_confidence or len(stripped) < MIN_BLOCK_CHARS:
                continue
            candidate_blocks.append(
                {
                    "text": stripped,
                    "box": box.tolist(),
                    "confidence": confidence,
                }
            )

        ordered = reading_order_sort(candidate_blocks)
        full_text = "\n".join(block["text"] for block in ordered)
        mean_confidence = (
            float(np.mean([block["confidence"] for block in ordered]))
            if ordered
            else 0.0
        )

        return {
            "text": full_text,
            "blocks": ordered,
            "text_area_fraction": area_fraction,
            "mean_confidence": mean_confidence,
        }
