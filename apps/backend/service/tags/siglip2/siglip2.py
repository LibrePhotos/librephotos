import os

import numpy as np
import onnxruntime as ort
import sentencepiece as spm
from PIL import Image

SIGLIP2_MODEL_DIR = os.path.join("/", "protected_media", "data_models", "siglip2")
SIGLIP2_VISION_PATH = os.path.join(SIGLIP2_MODEL_DIR, "vision_model.onnx")
SIGLIP2_TEXT_PATH = os.path.join(SIGLIP2_MODEL_DIR, "text_model.onnx")
SIGLIP2_TOKENIZER_PATH = os.path.join(SIGLIP2_MODEL_DIR, "tokenizer.model")
SIGLIP2_EMBEDDINGS_CACHE = os.path.join(SIGLIP2_MODEL_DIR, "tag_embeddings.npy")

TAGS_FILE = os.path.join(os.path.dirname(__file__), "tags.txt")

TARGET_SIZE = 384
IMAGE_MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32)
IMAGE_STD = np.array([0.5, 0.5, 0.5], dtype=np.float32)

MAX_TOKEN_LENGTH = 64
PAD_TOKEN_ID = 0
EOS_TOKEN_ID = 1


def _pool_embeddings(raw_output, attention_mask=None):
    """Pool model output to (batch, hidden_dim).

    If the output is already 2-D (batch, hidden_dim), return it directly.
    If it is 3-D (batch, seq_len, hidden_dim), pool by taking the last
    non-padding token per sequence (EOS-token pooling used by SigLIP).
    Falls back to taking the last sequence position if no attention mask.
    """
    if raw_output.ndim == 2:
        return raw_output

    # 3-D: (batch, seq_len, hidden_dim)
    if attention_mask is not None:
        # EOS token is the last attended position
        eos_indices = attention_mask.sum(axis=1) - 1  # (batch,)
        batch_idx = np.arange(raw_output.shape[0])
        pooled = raw_output[batch_idx, eos_indices]  # (batch, hidden_dim)
    else:
        # Fallback: take position 0 (CLS-style pooling for vision)
        pooled = raw_output[:, 0, :]

    return pooled


def _l2_normalize(embeddings):
    """L2-normalize along the last axis."""
    norms = np.linalg.norm(embeddings, axis=-1, keepdims=True)
    norms = np.maximum(norms, 1e-8)
    return embeddings / norms


class SigLIP2:
    def __init__(self):
        self.vision_session = None
        self.tokenizer = None
        self.tags = None
        self.tag_embeddings = None
        self.is_loaded = False

    def load(self):
        """Load the vision model, tokenizer, tag list, and pre-computed embeddings."""
        self.vision_session = ort.InferenceSession(
            SIGLIP2_VISION_PATH,
            providers=["CPUExecutionProvider"],
        )

        with open(TAGS_FILE, "r") as f:
            self.tags = [line.strip() for line in f if line.strip()]

        if os.path.exists(SIGLIP2_EMBEDDINGS_CACHE):
            self.tag_embeddings = np.load(SIGLIP2_EMBEDDINGS_CACHE)
            # Invalidate cache if tag count changed or embedding dimension is wrong
            needs_rebuild = False
            if self.tag_embeddings.ndim != 2:
                print(f"siglip2: cache has wrong shape {self.tag_embeddings.shape}, rebuilding...")
                needs_rebuild = True
            elif self.tag_embeddings.shape[0] != len(self.tags):
                print(
                    f"siglip2: cache has {self.tag_embeddings.shape[0]} tags "
                    f"but tags.txt has {len(self.tags)}, rebuilding..."
                )
                needs_rebuild = True
            elif self.tag_embeddings.shape[1] < 128:
                print(
                    f"siglip2: cache has dim={self.tag_embeddings.shape[1]} "
                    f"(likely stale from a failed build), rebuilding..."
                )
                needs_rebuild = True

            if needs_rebuild:
                os.remove(SIGLIP2_EMBEDDINGS_CACHE)
                self._build_tag_embeddings()
            else:
                print(
                    f"siglip2: loaded cached tag embeddings "
                    f"({self.tag_embeddings.shape[0]} tags, dim={self.tag_embeddings.shape[1]})"
                )
        else:
            self._build_tag_embeddings()

        self.is_loaded = True

    def unload(self):
        del self.vision_session
        del self.tag_embeddings
        del self.tokenizer
        self.vision_session = None
        self.tag_embeddings = None
        self.tokenizer = None
        self.tags = None
        self.is_loaded = False

    def _load_tokenizer(self):
        if self.tokenizer is None:
            self.tokenizer = spm.SentencePieceProcessor()
            self.tokenizer.Load(SIGLIP2_TOKENIZER_PATH)

    def _tokenize(self, texts, max_length=MAX_TOKEN_LENGTH):
        """Tokenize a list of texts using SentencePiece, returning input_ids and attention_mask."""
        self._load_tokenizer()

        batch_input_ids = []
        batch_attention_mask = []

        for text in texts:
            token_ids = self.tokenizer.Encode(text)
            # Truncate (leave room for EOS)
            token_ids = token_ids[: max_length - 1]
            # Append EOS
            token_ids.append(EOS_TOKEN_ID)

            attention_mask = [1] * len(token_ids)

            # Pad
            pad_length = max_length - len(token_ids)
            token_ids.extend([PAD_TOKEN_ID] * pad_length)
            attention_mask.extend([0] * pad_length)

            batch_input_ids.append(token_ids)
            batch_attention_mask.append(attention_mask)

        return (
            np.array(batch_input_ids, dtype=np.int64),
            np.array(batch_attention_mask, dtype=np.int64),
        )

    def _build_tag_embeddings(self):
        """Encode all tags with the text model and cache the embeddings."""
        print("siglip2: building tag embeddings (first run, this may take a minute)...")

        text_session = ort.InferenceSession(
            SIGLIP2_TEXT_PATH,
            providers=["CPUExecutionProvider"],
        )

        text_input_names = [inp.name for inp in text_session.get_inputs()]
        text_output_names = [out.name for out in text_session.get_outputs()]

        print(f"siglip2: text model inputs: {text_input_names}")
        print(f"siglip2: text model outputs: {text_output_names}")

        # Use prompt template for better zero-shot performance
        prompted_tags = [f"a photo of {tag}" for tag in self.tags]

        all_embeddings = []
        batch_size = 32

        for i in range(0, len(prompted_tags), batch_size):
            batch_texts = prompted_tags[i : i + batch_size]
            input_ids, attention_mask = self._tokenize(batch_texts)

            feed = {text_input_names[0]: input_ids}
            if len(text_input_names) > 1:
                feed[text_input_names[1]] = attention_mask

            # Run all outputs so we can pick the best one
            raw_outputs = text_session.run(None, feed)

            # Find the output that gives us pooled embeddings (batch, hidden_dim)
            # Prefer a 2-D output; if all are 3-D, pool the first one via EOS token
            embeddings = None
            for idx, out in enumerate(raw_outputs):
                if out.ndim == 2 and out.shape[0] == len(batch_texts):
                    embeddings = out
                    break

            if embeddings is None:
                # All outputs are 3-D; pool the first one using EOS token position
                embeddings = _pool_embeddings(raw_outputs[0], attention_mask)

            if i == 0:
                print(f"siglip2: text embedding shape per batch: {embeddings.shape}")

            embeddings = _l2_normalize(embeddings)
            all_embeddings.append(embeddings)

            if (i // batch_size) % 5 == 0:
                print(
                    f"siglip2: encoded {min(i + batch_size, len(prompted_tags))}"
                    f"/{len(prompted_tags)} tags"
                )

        del text_session

        self.tag_embeddings = np.concatenate(all_embeddings, axis=0)

        os.makedirs(os.path.dirname(SIGLIP2_EMBEDDINGS_CACHE), exist_ok=True)
        np.save(SIGLIP2_EMBEDDINGS_CACHE, self.tag_embeddings)
        print(
            f"siglip2: cached {self.tag_embeddings.shape[0]} tag embeddings "
            f"(dim={self.tag_embeddings.shape[1]}) to {SIGLIP2_EMBEDDINGS_CACHE}"
        )

    def prepare_image(self, image):
        """Resize, rescale, and normalize an image for SigLIP 2."""
        image = image.convert("RGB")
        image = image.resize((TARGET_SIZE, TARGET_SIZE), Image.BICUBIC)

        arr = np.array(image, dtype=np.float32) / 255.0
        arr = (arr - IMAGE_MEAN) / IMAGE_STD
        # HWC -> CHW
        arr = arr.transpose(2, 0, 1)
        # Add batch dimension
        return arr[np.newaxis, :]

    def predict(self, image_path, threshold=0.05, max_tags=10):
        """Run inference and return the top tags by cosine similarity.

        Args:
            image_path: Path to the image file.
            threshold: Minimum cosine similarity to include a tag.
            max_tags: Maximum number of tags to return.

        Returns:
            dict with "tags" key containing a list of predicted tag strings.
        """
        if not self.is_loaded:
            self.load()

        image = Image.open(image_path)
        pixel_values = self.prepare_image(image)

        vision_input_name = self.vision_session.get_inputs()[0].name

        # Run all outputs
        raw_outputs = self.vision_session.run(None, {vision_input_name: pixel_values})

        # Find the pooled image embedding (2-D preferred, else pool from 3-D)
        image_embeds = None
        for out in raw_outputs:
            if out.ndim == 2 and out.shape[0] == 1:
                image_embeds = out
                break

        if image_embeds is None:
            # 3-D output: pool via CLS token (position 0)
            image_embeds = _pool_embeddings(raw_outputs[0], attention_mask=None)

        image_embeds = _l2_normalize(image_embeds)

        # Compute cosine similarity: (1, dim) @ (n_tags, dim).T -> (1, n_tags)
        similarities = image_embeds @ self.tag_embeddings.T
        scores = similarities[0]

        # Get top tags sorted by score, filtered by threshold, capped at max_tags
        ranked_indices = np.argsort(scores)[::-1]
        predicted_tags = []
        for idx in ranked_indices:
            if scores[idx] < threshold:
                break
            predicted_tags.append(self.tags[idx])
            if len(predicted_tags) >= max_tags:
                break

        return {"tags": predicted_tags}
