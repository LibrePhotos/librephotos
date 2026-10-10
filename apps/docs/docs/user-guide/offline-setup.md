---
title: "Offline Usage"
description: "Learn how to configure LibrePhotos for offline use by manually downloading and placing the required machine learning models. This guide provides step-by-step instructions so your LibrePhotos installation can run its machine learning features without an Internet connection."
sidebar_position: 22
---

To enable LibrePhotos to run its machine learning features offline, you can manually download and place the required models by following the steps outlined below. This guide assumes that you have access to the Internet initially to download the models and then configure LibrePhotos to run in an offline environment.

### Step 1: Download the Models Manually

Manually download the necessary models from their respective URLs. Below is a list of models used by LibrePhotos, along with their download links:

1. **openclip_vitb32** (Tags, semantic search and similar photos)
   - `https://huggingface.co/derneuere/librephotos_models/resolve/main/openclip_vitb32/visual.onnx`
   - `https://huggingface.co/derneuere/librephotos_models/resolve/main/openclip_vitb32/textual.onnx`
   - `https://huggingface.co/derneuere/librephotos_models/resolve/main/openclip_vitb32/tokenizer.json`
   - `https://huggingface.co/derneuere/librephotos_models/resolve/main/openclip_vitb32/preprocess.json`
   - `https://huggingface.co/derneuere/librephotos_models/resolve/main/openclip_vitb32/LICENSE`
2. **lfm2_vl_450m** (Captioning)
   - `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/vision_encoder_q4.onnx`
   - `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/vision_encoder_q4.onnx_data`
   - `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/embed_tokens_q4.onnx`
   - `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/embed_tokens_q4.onnx_data`
   - `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/decoder_model_merged_q4.onnx`
   - `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/decoder_model_merged_q4.onnx_data`
   - Tokenizer: `https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/tokenizer.json`
3. **buffalo_sc** (Face recognition — default model)
   - URL: `https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip`
   - Only download the model selected in **Site Settings → Face Recognition Model**. The other options use the same release, e.g. `buffalo_s.zip`, `buffalo_m.zip`, `buffalo_l.zip`, `antelopev2.zip`.

### Step 2: Place the Models in the Correct Location

Once the models are downloaded, place them in the following directory:

```
<LibrePhotos Media Root Directory>/data_models/
```

`MEDIA_ROOT` is not something you set directly — it is derived from `BASE_DATA` (default `/`), so inside the container it is always `/protected_media`. On the host it is whichever directory you mounted to `/protected_media`. With the standard docker-compose install that is `${data}/protected_media`, which defaults to `./librephotos/data/protected_media/`, so the models go in `./librephotos/data/protected_media/data_models/`.

- **openclip_vitb32** files -> Place all five in `<MEDIA_ROOT>/data_models/openclip_vitb32/` under their own names
- **lfm2_vl_450m** files -> Place all seven in `<MEDIA_ROOT>/data_models/lfm2_vl_450m/` under their own names. The `.onnx_data` files hold the weights the small `.onnx` graphs point at, so the names must not change.
- **buffalo_sc.zip** -> Unpack into `<MEDIA_ROOT>/data_models/face_recognition/models/buffalo_sc/` (the folder should contain the `.onnx` files)

### Step 3: Verify Model Placement

Ensure that all models are correctly placed and unpacked in their respective directories. The structure should look something like this:

```
data_models/
    ├── openclip_vitb32/
    │   ├── visual.onnx
    │   ├── textual.onnx
    │   ├── tokenizer.json
    │   ├── preprocess.json
    │   └── LICENSE
    ├── lfm2_vl_450m/
    │   ├── vision_encoder_q4.onnx
    │   ├── vision_encoder_q4.onnx_data
    │   ├── embed_tokens_q4.onnx
    │   ├── embed_tokens_q4.onnx_data
    │   ├── decoder_model_merged_q4.onnx
    │   ├── decoder_model_merged_q4.onnx_data
    │   └── tokenizer.json
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
