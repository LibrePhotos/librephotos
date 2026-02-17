import os

import numpy as np
import onnxruntime as ort
from PIL import Image


JOYTAG_MODEL_DIR = os.path.join("/", "protected_media", "data_models", "joytag")
JOYTAG_MODEL_PATH = os.path.join(JOYTAG_MODEL_DIR, "model.onnx")
JOYTAG_TAGS_PATH = os.path.join(JOYTAG_MODEL_DIR, "top_tags.txt")

TARGET_SIZE = 448
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


class JoyTag:
    def __init__(self):
        self.session = None
        self.tags = None
        self.is_loaded = False

    def load(self):
        self.session = ort.InferenceSession(
            JOYTAG_MODEL_PATH,
            providers=["CPUExecutionProvider"],
        )
        with open(JOYTAG_TAGS_PATH, "r") as f:
            self.tags = [line.strip() for line in f.readlines() if line.strip()]
        self.is_loaded = True

    def unload(self):
        del self.session
        del self.tags
        self.session = None
        self.tags = None
        self.is_loaded = False

    def prepare_image(self, image):
        """Pad image to square, resize, and normalize."""
        image = image.convert("RGB")

        # Pad to square
        w, h = image.size
        max_dim = max(w, h)
        pad_left = (max_dim - w) // 2
        pad_top = (max_dim - h) // 2

        padded = Image.new("RGB", (max_dim, max_dim), (255, 255, 255))
        padded.paste(image, (pad_left, pad_top))

        # Resize
        if max_dim != TARGET_SIZE:
            padded = padded.resize((TARGET_SIZE, TARGET_SIZE), Image.BICUBIC)

        # Convert to numpy array (H, W, C) -> (C, H, W) float32 [0, 1]
        arr = np.array(padded, dtype=np.float32) / 255.0
        arr = arr.transpose(2, 0, 1)

        # Normalize with CLIP means/stds
        arr = (arr - MEAN[:, None, None]) / STD[:, None, None]

        # Add batch dimension: (1, C, H, W)
        return arr[np.newaxis, :]

    def predict(self, image_path, threshold=0.4, max_tags=15):
        """Run inference and return the top tags sorted by confidence.

        Args:
            image_path: Path to the image file.
            threshold: Minimum sigmoid score to include a tag.
            max_tags: Maximum number of tags to return.

        Returns:
            dict with "tags" key containing a list of predicted tag strings.
        """
        if not self.is_loaded:
            self.load()

        image = Image.open(image_path)
        tensor = self.prepare_image(image)

        input_name = self.session.get_inputs()[0].name
        preds = self.session.run(None, {input_name: tensor})[0]

        # Apply sigmoid
        scores = 1.0 / (1.0 + np.exp(-preds[0]))

        n_tags = len(self.tags)
        # Sort by score descending, filter by threshold, cap at max_tags
        ranked_indices = np.argsort(scores[:n_tags])[::-1]
        predicted_tags = []
        for idx in ranked_indices:
            if scores[idx] < threshold:
                break
            predicted_tags.append(self.tags[idx])
            if len(predicted_tags) >= max_tags:
                break

        return {"tags": predicted_tags}
