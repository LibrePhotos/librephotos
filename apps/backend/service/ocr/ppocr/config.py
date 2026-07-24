"""Configuration loading and validation for the vendored PP-OCRv6 bundle.

A bundle directory contains::

    det.onnx        detection (DBNet) model
    rec.onnx        recognition (CRNN + CTC) model
    charset.txt     recognition character dictionary, one entry per line
    config.json     preprocess/postprocess constants (see ``format`` key)

Nothing here is hardcoded from the model files themselves - every numeric
constant is read out of ``config.json``.  The one safety check that cannot
come from ``config.json`` alone is the recognition output width: it must line
up with the character dictionary, otherwise every decoded character is shifted
by one and the model produces confident nonsense.  ``build_decode_charset``
performs that check against the width read from the ONNX model at load time.
"""

import json
import os

import numpy as np

# Production install location.  Bundles ship to ``<models>/ocr/ppocrv6_<tier>``
# under the protected media data_models root (mirrors service/tags/siglip2,
# which hardcodes ``/protected_media/data_models/siglip2``).  Tests point
# ``OCR_MODEL_DIR`` at the extracted test bundle instead.
MODEL_DIR_ENV = "OCR_MODEL_DIR"
DEFAULT_MODEL_DIR = os.path.join(
    os.sep, "protected_media", "data_models", "ocr", "ppocrv6_small"
)


def resolve_model_dir(model_dir=None):
    """Resolve the bundle directory: explicit arg > env override > default."""
    if model_dir:
        return model_dir
    return os.environ.get(MODEL_DIR_ENV, DEFAULT_MODEL_DIR)


class OCRConfigError(RuntimeError):
    """Raised when a bundle is malformed or the charset does not match the model."""


class OCRConfig:
    """Parsed ``config.json`` + ``charset.txt`` for one bundle."""

    def __init__(self, model_dir=None):
        self.model_dir = resolve_model_dir(model_dir)
        self.config_path = os.path.join(self.model_dir, "config.json")
        self.charset_path = os.path.join(self.model_dir, "charset.txt")
        self.det_model_path = os.path.join(self.model_dir, "det.onnx")
        self.rec_model_path = os.path.join(self.model_dir, "rec.onnx")
        self._load()

    def _load(self):
        with open(self.config_path, encoding="utf-8") as f:
            raw = json.load(f)

        det = raw["det"]
        pre = det["preprocess"]
        # mean/std are RGB-ordered in the upstream inference.yml but are applied
        # to the image channels as-is.  See detect.normalize_image for the full
        # note on why they are *not* reordered to BGR.
        self.det_mean = np.array(pre["mean"], dtype=np.float32)
        self.det_std = np.array(pre["std"], dtype=np.float32)
        self.det_scale = float(pre["scale"])
        self.det_img_mode = pre.get("img_mode", "BGR")
        self.det_max_side = int(pre["max_side"])
        self.det_size_multiple = int(pre["size_multiple"])

        post = det["postprocess"]
        self.det_thresh = float(post["thresh"])
        self.det_box_thresh = float(post["box_thresh"])
        self.det_unclip_ratio = float(post["unclip_ratio"])
        self.det_max_candidates = int(post["max_candidates"])

        rec = raw["rec"]
        self.rec_input_shape = tuple(int(x) for x in rec["input_shape"])
        if len(self.rec_input_shape) != 3:
            raise OCRConfigError(
                f"rec.input_shape must be [C, H, W]; got {self.rec_input_shape}"
            )

        self.use_space_char = bool(raw.get("use_space_char", False))
        self.charset = self._load_charset()
        if not self.charset:
            raise OCRConfigError(f"empty charset at {self.charset_path}")

    def _load_charset(self):
        """Load charset preserving order and interior spaces.

        Only the trailing newline of each entry is stripped - a charset entry
        may legitimately be a single space, so ``str.strip()`` would corrupt it.
        The final blank line produced by a trailing newline is dropped.
        """
        with open(self.charset_path, encoding="utf-8") as f:
            lines = f.readlines()
        charset = [line.rstrip("\n").rstrip("\r") for line in lines]
        # A trailing newline yields one empty final entry; drop only that.
        if charset and charset[-1] == "":
            charset = charset[:-1]
        return charset

    def build_decode_charset(self, rec_output_dim):
        """Build the CTC index -> string table and validate against the model.

        Index 0 is the CTC blank.  Indices ``1..len(charset)`` map to the
        charset in order.  PP-OCR models trained with a space class carry one
        additional trailing class, so a bundle whose recognition head is two
        wider than the charset gets a trailing space entry.

        Raises ``OCRConfigError`` on any other width - a charset/model tier
        mismatch shifts every character by one and yields confident garbage, so
        we refuse to start rather than silently mis-decode.
        """
        n = len(self.charset)
        n_extra = int(rec_output_dim) - n
        # 1 extra  -> blank only.
        # 2 extra  -> blank + trailing space class (use_space_char models).
        if n_extra not in (1, 2):
            raise OCRConfigError(
                f"recognition model output width ({rec_output_dim}) does not match "
                f"charset size ({n}); expected {n + 1} or {n + 2}. "
                f"This indicates a tier/charset mismatch which would shift every "
                f"decoded character by one - refusing to start."
            )

        decode = ["<blank>"] + list(self.charset)
        if n_extra == 2:
            decode.append(" ")

        expected_extra = 2 if self.use_space_char else 1
        if n_extra != expected_extra:
            # The model geometry is authoritative; config.json's use_space_char
            # flag is only advisory.  Log the discrepancy but trust the model.
            print(
                f"ocr: note: rec output width implies "
                f"{'a space class' if n_extra == 2 else 'no space class'} but "
                f"config use_space_char={self.use_space_char}; trusting the model."
            )
        return decode
