import os
import pickle


import torch
from PIL import Image
from torchvision import transforms
from torchvision.transforms.functional import InterpolationMode

from api.im2txt.blip.blip import blip_decoder
from api.im2txt.model import DecoderRNN, EncoderCNN

blip_image_size = 384

embed_size = 256
hidden_size = 512
num_layers = 1

im2txt_models_path = "/protected_media/data_models/im2txt"

blip_models_path = "/protected_media/data_models/blip"

encoder_path = os.path.join(im2txt_models_path, "models", "encoder-10-1000.ckpt")
decoder_path = os.path.join(im2txt_models_path, "models", "decoder-10-1000.ckpt")
vocab_path = os.path.join(im2txt_models_path, "data", "vocab.pkl")



blip_model_url = os.path.join(blip_models_path, "model_base_capfilt_large.pth")
blip_config_url = os.path.join(blip_models_path, "med_config.json")


class Im2txt:
    def __init__(
        self,
        device=torch.device("cuda" if torch.cuda.is_available() else "cpu"),
        blip=False,
    ):
        self._instance = self
        self.encoder = None
        self.decoder = None
        self.vocab = None
        self.device = device
        self.blip = blip
        self.model = None

    def load_image(self, image_path, transform=None):
        image = Image.open(image_path)
        # Check if the image has 3 channels (RGB)
        if image.mode != "RGB":
            # Handle grayscale or other modes here (e.g., convert to RGB)
            image = image.convert("RGB")

        if transform is not None:
            image = transform(image).unsqueeze(0)

        return image

    def load_models(self, onnx=False):
        if self.encoder is not None or self.model is not None:
            return

        if self.blip:
            self.model = blip_decoder(
                pretrained=blip_model_url,
                image_size=blip_image_size,
                vit="base",
                med_config=blip_config_url,
            )
            self.model.eval()
            self.model.to(self.device)
            return

        with open(vocab_path, "rb") as f:
            self.vocab = pickle.load(f)

        # Build models
        self.encoder = EncoderCNN(
            embed_size
        ).eval()  # eval mode (batchnorm uses moving mean/variance)
        self.decoder = DecoderRNN(
            embed_size, hidden_size, len(self.vocab), num_layers
        )
        self.encoder = self.encoder.to(self.device)
        self.decoder = self.decoder.to(self.device)

        # Load the trained model parameters
        self.encoder.load_state_dict(
            torch.load(encoder_path, map_location=self.device)
        )
        self.decoder.load_state_dict(
            torch.load(decoder_path, map_location=self.device)
        )

        # self.encoder = torch.compile(self.encoder)
        # self.decoder = torch.compile(self.decoder)

    def unload_models(self):
        del self.encoder
        del self.decoder
        del self.model
        self.encoder = None
        self.decoder = None
        self.model = None

    def generate_caption(
        self,
        image_path,
        onnx=False,
    ):
        self.load_models(onnx=onnx)

        transform = transforms.Compose(
            [
                transforms.Resize((224, 224), interpolation=InterpolationMode.BICUBIC),
                transforms.ToTensor(),
                transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
            ]
        )

        blip_transform = transforms.Compose(
            [
                transforms.Resize(
                    (blip_image_size, blip_image_size),
                    interpolation=InterpolationMode.BICUBIC,
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    (0.48145466, 0.4578275, 0.40821073),
                    (0.26862954, 0.26130258, 0.27577711),
                ),
            ]
        )

        if self.blip:
            image = self.load_image(image_path, blip_transform).to(self.device)
            with torch.no_grad():
                caption_blip = self.model.generate(
                    image, sample=True, num_beams=3, max_length=50, min_length=10
                )
                return caption_blip[0]

        # Prepare an image
        image = self.load_image(image_path, transform)
        image_tensor = image.to(self.device)
        feature = self.encoder(image_tensor)
        sampled_ids = self.decoder.forward(feature)
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


