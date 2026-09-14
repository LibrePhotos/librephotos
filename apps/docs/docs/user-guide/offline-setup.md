---
title: "Offline Usage"
description: "Learn how to configure LibrePhotos for offline use by manually downloading and placing the required machine learning models. This guide provides step-by-step instructions so your LibrePhotos installation can run its machine learning features without an Internet connection."
sidebar_position: 22
---

To enable LibrePhotos to run its machine learning features offline, you can manually download and place the required models by following the steps outlined below. This guide assumes that you have access to the Internet initially to download the models and then configure LibrePhotos to run in an offline environment.

### Step 1: Download the Models Manually

Manually download the necessary models from their respective URLs. Below is a list of models used by LibrePhotos, along with their download links:

1. **clip_vit_b32** (Semantic search)
   - Vision model: `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx`
   - Text model: `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx`
   - Tokenizer: `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json`
2. **mobileclip_s2** (Tagging — default model)
   - Vision model: `https://huggingface.co/Xenova/mobileclip_s2/resolve/main/onnx/vision_model.onnx`
   - Text model: `https://huggingface.co/Xenova/mobileclip_s2/resolve/main/onnx/text_model.onnx`
   - Tokenizer: `https://huggingface.co/Xenova/mobileclip_s2/resolve/main/tokenizer.json`
3. **florence2_base_int8** (Captioning — default model)
   - `https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/onnx/vision_encoder_int8.onnx`
   - `https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/onnx/embed_tokens_int8.onnx`
   - `https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/onnx/encoder_model_int8.onnx`
   - `https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/onnx/decoder_model_merged_int8.onnx`
   - Tokenizer: `https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/tokenizer.json`
4. **florence2_base** (Captioning) (optional — only if using the "most accurate" variant)
   - The same four files without the `_int8` suffix, plus the same tokenizer.
5. **mistral-7b-instruct-v0.2.Q5_K_M** (LLM) (optional)
   - URL: `https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q5_K_M.gguf?download=true`
6. **moondream** (Captioning / LLM) (optional)
   - Text model: `https://huggingface.co/moondream/moondream-2b-2025-04-14-4bit/resolve/main/moondream2-text-model-f16.gguf?download=true`
   - Multimodal projector (mmproj): `https://huggingface.co/moondream/moondream-2b-2025-04-14-4bit/resolve/main/moondream2-mmproj-f16.gguf?download=true`
7. **siglip2** (Tagging) (optional — only if using SigLIP 2 tagging model)
   - Vision model: `https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/onnx/vision_model.onnx`
   - Text model: `https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/onnx/text_model.onnx`
   - Tokenizer: `https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/tokenizer.model`
8. **buffalo_sc** (Face recognition — default model)
   - URL: `https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip`
   - Only download the model selected in **Site Settings → Face Recognition Model**. The other options use the same release, e.g. `buffalo_s.zip`, `buffalo_m.zip`, `buffalo_l.zip`, `antelopev2.zip`.

### Step 2: Place the Models in the Correct Location

Once the models are downloaded, place them in the following directory:

```
<LibrePhotos Media Root Directory>/data_models/
```

`MEDIA_ROOT` is not something you set directly — it is derived from `BASE_DATA` (default `/`), so inside the container it is always `/protected_media`. On the host it is whichever directory you mounted to `/protected_media`. With the standard docker-compose install that is `${data}/protected_media`, which defaults to `./librephotos/data/protected_media/`, so the models go in `./librephotos/data/protected_media/data_models/`.

- **clip_vit_b32** files -> Place as `<MEDIA_ROOT>/data_models/clip_vit_b32/vision_model.onnx`, `.../text_model.onnx` and `.../tokenizer.json`
- **mobileclip_s2** files -> Place as `<MEDIA_ROOT>/data_models/mobileclip_s2/vision_model.onnx`, `.../text_model.onnx` and `.../tokenizer.json`
- **florence2_base_int8** files -> Place in `<MEDIA_ROOT>/data_models/florence2_base_int8/` **without** the `_int8` suffix: `vision_encoder.onnx`, `embed_tokens.onnx`, `encoder_model.onnx`, `decoder_model_merged.onnx` and `tokenizer.json`
- **florence2_base** files -> Place in `<MEDIA_ROOT>/data_models/florence2_base/` under the same five names
- **mistral-7b-instruct-v0.2.Q5_K_M.gguf** -> Place directly as `<MEDIA_ROOT>/data_models/mistral-7b-instruct-v0.2.Q5_K_M.gguf`
- **moondream2-text-model-f16.gguf** -> Place directly as `<MEDIA_ROOT>/data_models/moondream2-text-model-f16.gguf`
- **moondream2-mmproj-f16.gguf** -> Place directly as `<MEDIA_ROOT>/data_models/moondream2-mmproj-f16.gguf`
- **siglip2 vision_model.onnx** -> Place as `<MEDIA_ROOT>/data_models/siglip2/vision_model.onnx`
- **siglip2 text_model.onnx** -> Place as `<MEDIA_ROOT>/data_models/siglip2/text_model.onnx`
- **siglip2 tokenizer.model** -> Place as `<MEDIA_ROOT>/data_models/siglip2/tokenizer.model`
- **buffalo_sc.zip** -> Unpack into `<MEDIA_ROOT>/data_models/face_recognition/models/buffalo_sc/` (the folder should contain the `.onnx` files)

:::note
Moondream needs **both** files placed directly in `data_models/`. If only `moondream2-text-model-f16.gguf` is present, the LLM service fails to start with `Moondream mmproj file not found`.
:::

### Step 3: Verify Model Placement

Ensure that all models are correctly placed and unpacked in their respective directories. The structure should look something like this:

```
data_models/
    ├── clip_vit_b32/
    │   ├── vision_model.onnx
    │   ├── text_model.onnx
    │   └── tokenizer.json
    ├── mobileclip_s2/
    │   ├── vision_model.onnx
    │   ├── text_model.onnx
    │   └── tokenizer.json
    ├── florence2_base_int8/
    │   ├── vision_encoder.onnx
    │   ├── embed_tokens.onnx
    │   ├── encoder_model.onnx
    │   ├── decoder_model_merged.onnx
    │   └── tokenizer.json
    ├── mistral-7b-instruct-v0.2.Q5_K_M.gguf
    ├── moondream2-text-model-f16.gguf
    ├── moondream2-mmproj-f16.gguf
    ├── siglip2/
    │   ├── vision_model.onnx
    │   ├── text_model.onnx
    │   └── tokenizer.model
    └── face_recognition/
        └── models/
            └── buffalo_sc/
```

### Step 4: Turn Off the Online Map Services

Even with every model stored locally, two settings still reach the Internet by default:

- **Site Settings → Map Tiles** defaults to **PhotoPrism (default)**, which loads the map background from `https://cdn.photoprism.app/maps/default.json` every time a map is shown. The **OpenStreetMap** option is not an offline alternative either — it fetches tiles from `tile.openstreetmap.org` and fonts from `fonts.openmaptiles.org`. On an offline install, select **None (hide map)**, which turns off map rendering and makes no external requests.
- **Site Settings → Map Provider** (reverse geocoding) defaults to **Nominatim (OpenStreetMap)** and calls the public Nominatim service during scans to turn GPS coordinates into place names. Without Internet access these calls fail and are only logged as a warning, so photos keep their coordinates but get no place names and the Places albums stay empty. There is no offline geocoding provider, so this feature is unavailable offline.

### Step 5: Run LibrePhotos

You can now run LibrePhotos without an active Internet connection for the machine learning features. The application will use the models you manually downloaded and placed in the `data_models` directory.
