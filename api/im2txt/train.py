import argparse
import torch
import torch.nn as nn
import numpy as np
import os
import pickle
from api.im2txt.data_loader import get_loader 
from api.im2txt.build_vocab import Vocabulary
from api.im2txt.model import EncoderCNN, DecoderRNN
from torch.nn.utils.rnn import pack_padded_sequence
from torchvision import transforms

model_path = 'api/im2txt/models/'
crop_size = 224
vocab_path = 'api/im2txt/data/vocab.pkl'
image_dir = 'api/im2txt/data/resized2014/'
caption_path = 'api/im2txt/data/annotations/captions_train2014.json'
log_step = 10
save_step = 1000
embed_size = 256
hidden_size = 512
num_layers = 1
num_epochs = 5
batch_size = 128
num_workers = 2
learning_rate = 0.001

#     parser.add_argument('--model_path', type=str, default='models/' , help='path for saving trained models')
#     parser.add_argument('--crop_size', type=int, default=224 , help='size for randomly cropping images')
#     parser.add_argument('--vocab_path', type=str, default='data/vocab.pkl', help='path for vocabulary wrapper')
#     parser.add_argument('--image_dir', type=str, default='data/resized2014', help='directory for resized images')
#     parser.add_argument('--caption_path', type=str, default='data/annotations/captions_train2014.json', help='path for train annotation json file')
#     parser.add_argument('--log_step', type=int , default=10, help='step size for prining log info')
#     parser.add_argument('--save_step', type=int , default=1000, help='step size for saving trained models')
#     
#     # Model parameters
#     parser.add_argument('--embed_size', type=int , default=256, help='dimension of word embedding vectors')
#     parser.add_argument('--hidden_size', type=int , default=512, help='dimension of lstm hidden states')
#     parser.add_argument('--num_layers', type=int , default=1, help='number of layers in lstm')
#     
#     parser.add_argument('--num_epochs', type=int, default=5)
#     parser.add_argument('--batch_size', type=int, default=128)
#     parser.add_argument('--num_workers', type=int, default=2)
#

# Device configuration
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

def main():
    # Create model directory
    if not os.path.exists(model_path):
        os.makedirs(model_path)
    
    # Image preprocessing, normalization for the pretrained resnet
    transform = transforms.Compose([ 
        transforms.RandomCrop(crop_size),
        transforms.RandomHorizontalFlip(), 
        transforms.ToTensor(), 
        transforms.Normalize((0.485, 0.456, 0.406), 
                             (0.229, 0.224, 0.225))])
    
    # Load vocabulary wrapper
    with open(vocab_path, 'rb') as f:
        vocab = pickle.load(f)
    
    # Build data loader
    data_loader = get_loader(image_dir, caption_path, vocab, 
                             transform, batch_size,
                             shuffle=True, num_workers=num_workers) 

    # Build the models
    encoder = EncoderCNN(embed_size).to(device)
    decoder = DecoderRNN(embed_size, hidden_size, len(vocab), num_layers).to(device)
    
    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    params = list(decoder.parameters()) + list(encoder.linear.parameters()) + list(encoder.bn.parameters())
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
                print('Epoch [{}/{}], Step [{}/{}], Loss: {:.4f}, Perplexity: {:5.4f}'
                      .format(epoch, num_epochs, i, total_step, loss.item(), np.exp(loss.item()))) 
                
            # Save the model checkpoints
            if (i+1) % save_step == 0:
                torch.save(decoder.state_dict(), os.path.join(
                    model_path, 'decoder-{}-{}.ckpt'.format(epoch+1, i+1)))
                torch.save(encoder.state_dict(), os.path.join(
                    model_path, 'encoder-{}-{}.ckpt'.format(epoch+1, i+1)))


# if __name__ == '__main__':
#     parser = argparse.ArgumentParser()
# #     parser.add_argument('--model_path', type=str, default='models/' , help='path for saving trained models')
# #     parser.add_argument('--crop_size', type=int, default=224 , help='size for randomly cropping images')
# #     parser.add_argument('--vocab_path', type=str, default='data/vocab.pkl', help='path for vocabulary wrapper')
# #     parser.add_argument('--image_dir', type=str, default='data/resized2014', help='directory for resized images')
# #     parser.add_argument('--caption_path', type=str, default='data/annotations/captions_train2014.json', help='path for train annotation json file')
# #     parser.add_argument('--log_step', type=int , default=10, help='step size for prining log info')
# #     parser.add_argument('--save_step', type=int , default=1000, help='step size for saving trained models')
# #     
# #     # Model parameters
# #     parser.add_argument('--embed_size', type=int , default=256, help='dimension of word embedding vectors')
# #     parser.add_argument('--hidden_size', type=int , default=512, help='dimension of lstm hidden states')
# #     parser.add_argument('--num_layers', type=int , default=1, help='number of layers in lstm')
# #     
# #     parser.add_argument('--num_epochs', type=int, default=5)
# #     parser.add_argument('--batch_size', type=int, default=128)
# #     parser.add_argument('--num_workers', type=int, default=2)
# #     parser.add_argument('--learning_rate', type=float, default=0.001)
#     args = parser.parse_args()
#     print(args)
#     main(args)
