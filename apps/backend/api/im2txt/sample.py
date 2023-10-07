import os
import pickle
import time

# import matplotlib.pyplot as plt
import torch
from django.conf import settings
from PIL import Image
from torchvision import transforms

from api.im2txt.model import DecoderRNN, EncoderCNN

embed_size = 256
hidden_size = 512
num_layers = 1
im2txt_models_path = settings.IM2TXT_ROOT

encoder_path = os.path.join(im2txt_models_path, "models", "encoder-10-1000.ckpt")
decoder_path = os.path.join(im2txt_models_path, "models", "decoder-10-1000.ckpt")
vocab_path = os.path.join(im2txt_models_path, "data", "vocab.pkl")


class Im2txt(object):
    def __init__(
        self, device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ):
        self._instance = self
        self.encoder = None
        self.decoder = None
        self.vocab = None
        self.device = device
        self.last_used_time = None

    def load_image(self, image_path, transform=None):
        image = Image.open(image_path)
        # Check if the image has 3 channels (RGB)
        if image.mode != "RGB":
            # Handle grayscale or other modes here (e.g., convert to RGB)
            image = image.convert("RGB")
        image = image.resize([224, 224], Image.LANCZOS)

        if transform is not None:
            image = transform(image).unsqueeze(0)

        return image

    def load_models(
        self,
    ):
        if self.encoder is not None:
            return

        # Load vocabulary wrapper
        with open(vocab_path, "rb") as f:
            self.vocab = pickle.load(f)
        # Build models
        self.encoder = EncoderCNN(
            embed_size
        ).eval()  # eval mode (batchnorm uses moving mean/variance)
        self.decoder = DecoderRNN(embed_size, hidden_size, len(self.vocab), num_layers)
        self.encoder = self.encoder.to(self.device)
        self.decoder = self.decoder.to(self.device)

        # Load the trained model parameters
        self.encoder.load_state_dict(torch.load(encoder_path, map_location=self.device))
        self.decoder.load_state_dict(torch.load(decoder_path, map_location=self.device))

    def unload_models(self):
        self.encoder.__del__()
        self.decoder.__del__()
        self.encoder = None
        self.decoder = None

    def unload_model_if_inactive(self, timeout=30):
        if (
            self.last_used_time is not None
            and time.time() - self.last_used_time > timeout
        ):
            self.unload_models()
            self.last_used_time = None

    def generate_caption(
        self,
        image_path,
    ):
        self.last_used_time = time.time()
        # Image preprocessing
        transform = transforms.Compose(
            [
                transforms.ToTensor(),
                transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
            ]
        )

        self.load_models()

        # Prepare an image
        image = self.load_image(image_path, transform)

        image_tensor = image.to(self.device)

        # Generate an caption from the image
        feature = self.encoder(image_tensor)
        sampled_ids = self.decoder.sample(feature)
        sampled_ids = (
            sampled_ids[0].cpu().numpy()
        )  # (1, max_seq_length) -> (max_seq_length)

        # Convert word_ids to words
        sampled_caption = []
        for word_id in sampled_ids:
            word = self.vocab.idx2word[word_id]
            sampled_caption.append(word)
            if word == "<end>":
                break
        sentence = " ".join(sampled_caption)
        return sentence
