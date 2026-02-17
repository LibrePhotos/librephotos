---
title: "📝 Image Captioning"
excerpt: "What is image captioning and how do I use it?"
sidebar_position: 6
---

## What is image captioning?

The goal of automatic image captioning to understand the content of an image and then produce a coherent and contextually relevant sentence or phrase that describes what is happening in the image.

To use the feature in LibrePhotos, open up an image, click on the information icon and then click on the generate button below the caption segment. It should generate a phrase, which should describe your image.

## How do I change the model?

Click on your avatar in the top right, and go to `Admin Area`. There is a setting for `Captioning Model`. You can select here between the different models. After selecting a model, it will be downloaded and added to your data_models folder.

## What is the difference between the models?

Currently, there are four available models: "im2txt PyTorch," "im2txt Onnx," "Blip," and "Moondream 2."

### im2txt PyTorch

This model serves as the default choice. It offers rapid results and represents the original implementation of the image captioning task. It uses the PyTorch deep learning framework, it has been a reliable option for users seeking both speed and baseline performance.

### im2txt ONNX

Utilizing the Open Neural Network Exchange (ONNX) as its engine, "im2txt Onnx" is designed for enhanced efficiency during inference. It exhibits a slight speed improvement compared to the original PyTorch model. The integration of ONNX facilitates seamless deployment across different platforms.

### Blip Base Capfilt Large

The next generation model "Blip" excels in providing highly accurate image descriptions. However, it comes with a trade-off, as it operates at approximately 20 times slower speeds than "im2txt PyTorch." This deliberate sacrifice in speed is made to achieve superior descriptive accuracy, making "Blip" an ideal choice for applications prioritizing precision over real-time processing.

### Moondream 2

Moondream 2 is a multi-modal model (via llama-cpp-python) that can analyze both images and text together. It produces richer, more contextually aware captions compared to the other models and lays the groundwork for advanced features like visual queries. It requires more resources than the simpler models but produces the most detailed descriptions.

Users can choose a model based on their specific requirements, balancing the need for speed, accuracy, and the trade-offs associated with each implementation. It's recommended to consider the performance of your system and the desired performance characteristics when selecting the most suitable model.
