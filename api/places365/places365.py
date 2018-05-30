# PlacesCNN to predict the scene category, attribute, and class activation map in a single pass
# by Bolei Zhou, sep 2, 2017
# last modified date: Dec. 27, 2017, migrating everything to python36 and latest pytorch and torchvision

import torch
from torch.autograd import Variable as V
import torchvision.models as models
from torchvision import transforms as trn
from torch.nn import functional as F
import os
import numpy as np
from scipy.misc import imresize as imresize
import cv2
from PIL import Image
from tqdm import tqdm
import warnings
import wideresnet

torch.nn.Module.dump_patches = True

dir_places365_model = os.path.join(os.path.dirname(__file__),'model')

def load_labels():
    # prepare all the labels
    # scene category relevant
    file_path_category = os.path.join(dir_places365_model,'categories_places365.txt')
    classes = list()
    with open(file_path_category) as class_file:
        for line in class_file:
            classes.append(line.strip().split(' ')[0][3:])
    classes = tuple(classes)

    # indoor and outdoor relevant
    file_path_IO = os.path.join(dir_places365_model,'IO_places365.txt')
    with open(file_path_IO) as f:
        lines = f.readlines()
        labels_IO = []
        for line in lines:
            items = line.rstrip().split()
            labels_IO.append(int(items[-1]) -1) # 0 is indoor, 1 is outdoor
    labels_IO = np.array(labels_IO)

    # scene attribute relevant
    file_path_attribute = os.path.join(dir_places365_model,'labels_sunattribute.txt')
    with open(file_path_attribute) as f:
        lines = f.readlines()
        labels_attribute = [item.rstrip() for item in lines]

    file_path_W = os.path.join(dir_places365_model,'W_sceneattribute_wideresnet18.npy')
    W_attribute = np.load(file_path_W)

    return classes, labels_IO, labels_attribute, W_attribute

def returnTF():
# load the image transformer
    tf = trn.Compose([
        trn.Resize((224,224)),
        trn.ToTensor(),
        trn.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])
    return tf

def remove_nonspace_separators(text):
    return ' '.join(' '.join(' '.join(text.split('_')).split('/')).split('-'))


# load the labels
classes, labels_IO, labels_attribute, W_attribute = load_labels()


# img_root = '/home/hooram/ownphotos_media/photos/'

# img_paths = [f for f in os.listdir(img_root) if f.endswith('.jpg')]

def inference_places365(img_path):


    def hook_feature(module, input, output):
        features_blobs.append(np.squeeze(output.data.cpu().numpy()))

    def load_model():
        # this model has a last conv feature map as 14x14
        # model_file = os.path.join(dir_places365_model,'whole_wideresnet18_places365_python36.pth.tar')
        model_file = os.path.join(dir_places365_model,'wideresnet18_places365.pth.tar')

        model = wideresnet.resnet18(num_classes=365)
        checkpoint = torch.load(model_file, map_location=lambda storage, loc: storage)
        state_dict = {str.replace(k,'module.',''): v for k,v in checkpoint['state_dict'].items()}
        model.load_state_dict(state_dict)
        model.eval()
        # hook the feature extractor
        features_names = ['layer4','avgpool'] # this is the last conv layer of the resnet
        for name in features_names:
            model._modules.get(name).register_forward_hook(hook_feature)
        return model


    # load the model
    features_blobs = []
    model = load_model()

    # load the transformer
    tf = returnTF() # image transformer

    # get the softmax weight
    params = list(model.parameters())
    weight_softmax = params[-2].data.numpy()
    weight_softmax[weight_softmax<0] = 0

    
    # load the test image
    # img_url = 'http://places2.csail.mit.edu/imgs/12.jpg'
    # os.system('wget %s -q -O test.jpg' % img_url)
    img = Image.open(img_path)
    input_img = V(tf(img).unsqueeze(0))

    # forward pass
    logit = model.forward(input_img)
    h_x = F.softmax(logit, 1).data.squeeze()
    probs, idx = h_x.sort(0, True)
    probs = probs.numpy()
    idx = idx.numpy()

    res = {}

    # output the IO prediction
    io_image = np.mean(labels_IO[idx[:10]]) # vote for the indoor or outdoor
    if io_image < 0.5:
        res['environment'] = 'indoor'
    else:
        res['environment'] = 'outdoor'

    # output the prediction of scene category
    res['categories'] = []
    for i in range(0, 5):
        res['categories'].append(remove_nonspace_separators(classes[idx[i]]))

    # output the scene attributes
    responses_attribute = W_attribute.dot(features_blobs[1])
    idx_a = np.argsort(responses_attribute)
    res['attributes'] = [ remove_nonspace_separators(labels_attribute[idx_a[i]]) for i in range(-1,-10,-1)]

    return res


