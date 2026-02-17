---
title: "Offline Usage"
excerpt: "Learn how to configure LibrePhotos for complete offline usage by manually downloading and placing the required machine learning models. This guide provides step-by-step instructions to ensure your LibrePhotos installation functions seamlessly without an Internet connection."
sidebar_position: 5
---

To enable LibrePhotos to work completely offline by manually downloading and placing the required machine learning models, you can follow the steps outlined below. This guide assumes that you have access to the Internet initially to download the models and then configure LibrePhotos to run in an offline environment.

### Step 1: Download the Models Manually

Manually download the necessary models from their respective URLs. Below is a list of models used by LibrePhotos, along with their download links:

1. **im2txt** (Captioning)
   - URL: `https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz`
2. **clip-embeddings** (CLIP)
   - URL: `https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/clip-embeddings.tar.gz`
3. **places365** (Categories)
   - URL: `https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz`
4. **resnet18** (Categories)
   - URL: `https://download.pytorch.org/models/resnet18-5c106cde.pth`
5. **im2txt_onnx** (Captioning)
   - URL: `https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt_onnx.tar.gz`
6. **blip_base_capfilt_large** (Captioning) (optional)
   - URL: `https://huggingface.co/derneuere/librephotos_models/resolve/main/blip_large.tar.gz?download=true`
7. **mistral-7b-v0.1.Q5_K_M** (LLM) (optional)
   - URL: `https://huggingface.co/TheBloke/Mistral-7B-v0.1-GGUF/resolve/main/mistral-7b-v0.1.Q5_K_M.gguf?download=true`
8. **mistral-7b-instruct-v0.2.Q5_K_M** (LLM) (optional)
   - URL: `https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q5_K_M.gguf?download=true`
9. **joytag** (Tagging) (optional — only if using JoyTag tagging model)
   - Model: `https://huggingface.co/fancyfeast/joytag/resolve/main/model.onnx`
   - Tags: `https://huggingface.co/fancyfeast/joytag/resolve/main/top_tags.txt`
10. **siglip2** (Tagging) (optional — only if using SigLIP 2 tagging model)
    - Vision model: `https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/onnx/vision_model.onnx`
    - Text model: `https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/onnx/text_model.onnx`
    - Tokenizer: `https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/tokenizer.model`

### Step 2: Place the Models in the Correct Location

Once the models are downloaded, place them in the following directory:

```
<LibrePhotos Media Root Directory>/data_models/
```

For example, if your `MEDIA_ROOT` is set to `/var/lib/librephotos`, then the models should be placed in `/var/lib/librephotos/data_models/`.

- **im2txt.tar.gz** -> Unpack into `<MEDIA_ROOT>/data_models/im2txt/`
- **clip-embeddings.tar.gz** -> Unpack into `<MEDIA_ROOT>/data_models/clip-embeddings/`
- **places365.tar.gz** -> Unpack into `<MEDIA_ROOT>/data_models/places365/`
- **resnet18-5c106cde.pth** -> Place directly as `<MEDIA_ROOT>/data_models/resnet18-5c106cde.pth`
- **im2txt_onnx.tar.gz** -> Unpack into `<MEDIA_ROOT>/data_models/im2txt_onnx/`
- **blip_large.tar.gz** -> Unpack into `<MEDIA_ROOT>/data_models/blip/`
- **mistral-7b-v0.1.Q5_K_M.gguf** -> Place directly as `<MEDIA_ROOT>/data_models/mistral-7b-v0.1.Q5_K_M.gguf`
- **mistral-7b-instruct-v0.2.Q5_K_M.gguf** -> Place directly as `<MEDIA_ROOT>/data_models/mistral-7b-instruct-v0.2.Q5_K_M.gguf`
- **joytag model.onnx** -> Place as `<MEDIA_ROOT>/data_models/joytag/model.onnx`
- **joytag top_tags.txt** -> Place as `<MEDIA_ROOT>/data_models/joytag/top_tags.txt`
- **siglip2 vision_model.onnx** -> Place as `<MEDIA_ROOT>/data_models/siglip2/vision_model.onnx`
- **siglip2 text_model.onnx** -> Place as `<MEDIA_ROOT>/data_models/siglip2/text_model.onnx`
- **siglip2 tokenizer.model** -> Place as `<MEDIA_ROOT>/data_models/siglip2/tokenizer.model`

### Step 3: Verify Model Placement

Ensure that all models are correctly placed and unpacked in their respective directories. The structure should look something like this:

```
data_models/
    ├── im2txt/
    ├── clip-embeddings/
    ├── places365/
    ├── resnet18-5c106cde.pth
    ├── im2txt_onnx/
    ├── blip/
    ├── mistral-7b-v0.1.Q5_K_M.gguf
    ├── mistral-7b-instruct-v0.2.Q5_K_M.gguf
    ├── joytag/
    │   ├── model.onnx
    │   └── top_tags.txt
    └── siglip2/
        ├── vision_model.onnx
        ├── text_model.onnx
        └── tokenizer.model
```

### Step 4: Run LibrePhotos

You can now run LibrePhotos without an active Internet connection. The application will use the models you manually downloaded and placed in the `data_models` directory.
