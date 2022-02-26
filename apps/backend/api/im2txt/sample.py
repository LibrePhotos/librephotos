import os
import pickle

# import matplotlib.pyplot as plt
import torch
from PIL import Image
from torchvision import transforms

import ownphotos.settings
from api.im2txt.model import DecoderRNN, EncoderCNN

embed_size = 256
hidden_size = 512
num_layers = 1
im2txt_models_path = ownphotos.settings.IM2TXT_ROOT

encoder_path = os.path.join(im2txt_models_path, "models", "encoder-10-1000.ckpt")
decoder_path = os.path.join(im2txt_models_path, "models", "decoder-10-1000.ckpt")
vocab_path = os.path.join(im2txt_models_path, "data", "vocab.pkl")

# Device configuration
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
# device = torch.device('cpu')

# Load vocabulary wrapper
with open(vocab_path, "rb") as f:
    vocab = pickle.load(f)


def load_image(image_path, transform=None):
    image = Image.open(image_path)
    image = image.resize([224, 224], Image.LANCZOS)

    if transform is not None:
        image = transform(image).unsqueeze(0)

    return image


def im2txt(image_path):
    # Image preprocessing
    transform = transforms.Compose(
        [
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ]
    )

    # Build models
    encoder = EncoderCNN(
        embed_size
    ).eval()  # eval mode (batchnorm uses moving mean/variance)
    decoder = DecoderRNN(embed_size, hidden_size, len(vocab), num_layers)
    encoder = encoder.to(device)
    decoder = decoder.to(device)

    # Load the trained model parameters
    encoder.load_state_dict(torch.load(encoder_path, map_location="cpu"))
    decoder.load_state_dict(torch.load(decoder_path, map_location="cpu"))

    # Prepare an image
    image = load_image(image_path, transform)
    image_tensor = image.to(device)

    # Generate an caption from the image
    feature = encoder(image_tensor)
    sampled_ids = decoder.sample(feature)
    sampled_ids = (
        sampled_ids[0].cpu().numpy()
    )  # (1, max_seq_length) -> (max_seq_length)

    # Convert word_ids to words
    sampled_caption = []
    for word_id in sampled_ids:
        word = vocab.idx2word[word_id]
        sampled_caption.append(word)
        if word == "<end>":
            break
    sentence = " ".join(sampled_caption)
    return sentence
