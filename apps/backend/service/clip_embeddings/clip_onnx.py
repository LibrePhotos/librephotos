"""CLIP ViT-B/32 image and text embeddings for semantic search, on ONNX Runtime.

These are the same OpenAI ViT-B/32 weights the sentence-transformers
``clip-ViT-B-32`` bundle wrapped before, exported to ONNX
(Xenova/clip-vit-base-patch32), so embeddings already stored in the database
stay comparable with the ones computed here: the text tower matches to the
last float and the image tower agrees to a cosine of 0.998 or better, the
remainder being resize rounding.

Embeddings are returned unnormalised, as before; the callers store the
magnitude next to the vector and normalise at query time.
"""

import os

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

IMAGE_SIZE = 224
IMAGE_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
IMAGE_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
CONTEXT_LENGTH = 77
IMAGE_BATCH_SIZE = 32


def prepare_image(image, size=IMAGE_SIZE):
    """Shortest-edge resize, centre crop, CLIP-normalised CHW float32."""
    image = image.convert("RGB")
    width, height = image.size
    scale = size / min(width, height)
    image = image.resize(
        (max(size, round(width * scale)), max(size, round(height * scale))),
        Image.BICUBIC,
    )
    width, height = image.size
    left = (width - size) // 2
    top = (height - size) // 2
    image = image.crop((left, top, left + size, top + size))

    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = (arr - IMAGE_MEAN) / IMAGE_STD
    return np.ascontiguousarray(arr.transpose(2, 0, 1))


class ClipEmbeddings:
    def __init__(self):
        self.model_dir = None
        self.vision_session = None
        self.text_session = None
        self.tokenizer = None

    @property
    def is_loaded(self):
        return self.vision_session is not None

    def load(self, model_dir):
        self.vision_session = ort.InferenceSession(
            os.path.join(model_dir, "vision_model.onnx"),
            providers=["CPUExecutionProvider"],
        )
        self.text_session = ort.InferenceSession(
            os.path.join(model_dir, "text_model.onnx"),
            providers=["CPUExecutionProvider"],
        )
        self.tokenizer = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        self.model_dir = model_dir

    def unload(self):
        self.vision_session = None
        self.text_session = None
        self.tokenizer = None
        self.model_dir = None

    def _ensure_loaded(self, model_dir):
        if not self.is_loaded or model_dir != self.model_dir:
            self.load(model_dir)

    def encode_images(self, image_paths, model_dir):
        """One embedding per path, in order; ``None`` where the image is unreadable.

        Keeping the slot for a bad image is what lets the caller line the
        results up with the photos it asked about.
        """
        self._ensure_loaded(model_dir)
        input_name = self.vision_session.get_inputs()[0].name

        results = [None] * len(image_paths)
        pending = []
        for index, path in enumerate(image_paths):
            try:
                with Image.open(path) as image:
                    pending.append((index, prepare_image(image)))
            except (OSError, ValueError) as error:
                # PIL.UnidentifiedImageError is an OSError; a truncated or
                # missing file lands here too rather than sinking the batch.
                print(f"clip embeddings: skipping unreadable image {path}: {error}")

        for start in range(0, len(pending), IMAGE_BATCH_SIZE):
            batch = pending[start : start + IMAGE_BATCH_SIZE]
            pixel_values = np.stack([pixels for _, pixels in batch])
            (embeddings,) = self.vision_session.run(None, {input_name: pixel_values})
            for (index, _), embedding in zip(batch, embeddings):
                results[index] = embedding.astype(np.float32)
        return results

    def encode_text(self, text, model_dir):
        self._ensure_loaded(model_dir)
        ids = self.tokenizer.encode(text).ids[:CONTEXT_LENGTH]
        input_name = self.text_session.get_inputs()[0].name
        (embeddings,) = self.text_session.run(
            None, {input_name: np.array([ids], dtype=np.int64)}
        )
        return embeddings[0].astype(np.float32)
