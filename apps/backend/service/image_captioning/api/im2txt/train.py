import os
import pickle

import numpy as np
import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence
from torchvision import transforms

from api.im2txt.data_loader import get_loader
from api.im2txt.model import DecoderRNN, EncoderCNN

model_path = "api/im2txt/models/"
crop_size = 224
vocab_path = "api/im2txt/data/vocab.pkl"
image_dir = "api/im2txt/data/resized2014/"
caption_path = "api/im2txt/data/annotations/captions_train2014.json"
log_step = 10
save_step = 1000
embed_size = 256
hidden_size = 512
num_layers = 1
num_epochs = 5
batch_size = 128
num_workers = 2
learning_rate = 0.001


# Device configuration
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def main():
    # Create model directory
    if not os.path.exists(model_path):
        os.makedirs(model_path)

    # Image preprocessing, normalization for the pretrained resnet
    transform = transforms.Compose(
        [
            transforms.RandomCrop(crop_size),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ]
    )

    # Load vocabulary wrapper
    with open(vocab_path, "rb") as f:
        vocab = pickle.load(f)

    # Build data loader
    data_loader = get_loader(
        image_dir,
        caption_path,
        vocab,
        transform,
        batch_size,
        shuffle=True,
        num_workers=num_workers,
    )

    # Build the models
    encoder = EncoderCNN(embed_size).to(device)
    decoder = DecoderRNN(embed_size, hidden_size, len(vocab), num_layers).to(device)

    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    params = (
        list(decoder.parameters())
        + list(encoder.linear.parameters())
        + list(encoder.bn.parameters())
    )
    optimizer = torch.optim.Adam(params, lr=learning_rate)

    # Train the models
    total_step = len(data_loader)
    for epoch in range(num_epochs):
        for i, (images, captions, lengths) in enumerate(data_loader):
            # Set mini-batch dataset
            images = images.to(device)
            captions = captions.to(device)
            targets = pack_padded_sequence(captions, lengths, batch_first=True)[0]

            # Forward, backward and optimize
            features = encoder(images)
            outputs = decoder(features, captions, lengths)
            loss = criterion(outputs, targets)
            decoder.zero_grad()
            encoder.zero_grad()
            loss.backward()
            optimizer.step()

            # Print log info
            if i % log_step == 0:
                print(
                    f"Epoch [{epoch}/{num_epochs}], Step [{i}/{total_step}], Loss: {loss.item():.4f}, Perplexity: {np.exp(loss.item()):5.4f}"
                )

            # Save the model checkpoints
            if (i + 1) % save_step == 0:
                torch.save(
                    decoder.state_dict(),
                    os.path.join(model_path, f"decoder-{epoch + 1}-{i + 1}.ckpt"),
                )
                torch.save(
                    encoder.state_dict(),
                    os.path.join(model_path, f"encoder-{epoch + 1}-{i + 1}.ckpt"),
                )
