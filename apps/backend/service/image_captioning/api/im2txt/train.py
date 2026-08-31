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


def build_transform():
    # Image preprocessing, normalization for the pretrained resnet
    return transforms.Compose(
        [
            transforms.RandomCrop(crop_size),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ]
    )


def load_vocab():
    with open(vocab_path, "rb") as f:
        return pickle.load(f)


def train_step(encoder, decoder, criterion, optimizer, batch):
    images, captions, lengths = batch
    images = images.to(device)
    captions = captions.to(device)
    targets = pack_padded_sequence(captions, lengths, batch_first=True)[0]

    features = encoder(images)
    outputs = decoder(features, captions, lengths)
    loss = criterion(outputs, targets)
    decoder.zero_grad()
    encoder.zero_grad()
    loss.backward()
    optimizer.step()
    return loss


def log_progress(epoch, step, total_step, loss):
    print(
        f"Epoch [{epoch}/{num_epochs}], Step [{step}/{total_step}], Loss: {loss.item():.4f}, Perplexity: {np.exp(loss.item()):5.4f}"
    )


def save_checkpoints(encoder, decoder, epoch, step):
    torch.save(
        decoder.state_dict(),
        os.path.join(model_path, f"decoder-{epoch + 1}-{step + 1}.ckpt"),
    )
    torch.save(
        encoder.state_dict(),
        os.path.join(model_path, f"encoder-{epoch + 1}-{step + 1}.ckpt"),
    )


def run_epoch(epoch, data_loader, encoder, decoder, criterion, optimizer, total_step):
    for i, batch in enumerate(data_loader):
        loss = train_step(encoder, decoder, criterion, optimizer, batch)

        if i % log_step == 0:
            log_progress(epoch, i, total_step, loss)

        if (i + 1) % save_step == 0:
            save_checkpoints(encoder, decoder, epoch, i)


def main():
    # Create model directory
    if not os.path.exists(model_path):
        os.makedirs(model_path)

    transform = build_transform()
    vocab = load_vocab()

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
        run_epoch(
            epoch, data_loader, encoder, decoder, criterion, optimizer, total_step
        )
